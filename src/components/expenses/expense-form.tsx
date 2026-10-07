"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { createExpense } from "@/actions/expenses/create";
import { uploadReceiptAction } from "@/actions/expenses/upload-receipt";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { SplitMethod } from "@/generated/prisma/enums";
import { formatMoney, parseMoneyInput } from "@/lib/money";
import { computeSplits, SplitError, type ComputedSplit } from "@/lib/splits/engine";

export interface FormMember {
  userId: string;
  name: string;
  isPlaceholder: boolean;
}

export interface FormCategory {
  id: string;
  name: string;
}

const METHODS: Array<{ value: SplitMethod; label: string; hint: string }> = [
  { value: "EQUAL", label: "Equally", hint: "Split evenly between everyone selected." },
  { value: "EXACT", label: "Exact amounts", hint: "Enter what each person owes." },
  { value: "PERCENTAGE", label: "Percentages", hint: "Shares must add up to 100%." },
  { value: "SHARES", label: "Shares", hint: "Split in proportion, e.g. 2:1:1." },
];

/**
 * The expense form.
 *
 * The preview below the inputs is computed with `@/lib/splits/engine` — the very
 * same function the server runs. §2.5 means the client's numbers are never
 * trusted, but using one implementation means what you see here is exactly what
 * gets recorded, down to which person absorbs the leftover cent (§2.6).
 */
export function ExpenseForm({
  householdId,
  currency,
  members,
  categories,
  viewerUserId,
}: {
  householdId: string;
  currency: string;
  members: FormMember[];
  categories: FormCategory[];
  viewerUserId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [description, setDescription] = useState("");
  const [amountText, setAmountText] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState<string>("");
  const [paidByUserId, setPaidByUserId] = useState(viewerUserId);
  const [method, setMethod] = useState<SplitMethod>("EQUAL");
  const [selected, setSelected] = useState<string[]>(() => members.map((m) => m.userId));
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const amountCents = parseMoneyInput(amountText, currency);

  /** The exact amounts the server will compute, or the reason it will refuse. */
  const preview = useMemo((): Preview | null => {
    if (amountCents === null || amountCents === 0 || selected.length === 0) {
      return null;
    }
    const participants = selected.map((userId) => {
      const raw = weights[userId] ?? "";
      switch (method) {
        case "EXACT":
          return { userId, amountCents: parseMoneyInput(raw, currency) ?? undefined };
        case "PERCENTAGE": {
          const percent = parseMoneyInput(raw, "XXX");
          // Percentages are entered as a number, stored as basis points.
          return { userId, percentBps: percent === null ? undefined : percent };
        }
        case "SHARES": {
          const shares = Number(raw);
          return {
            userId,
            shares: Number.isInteger(shares) && shares > 0 ? shares : undefined,
          };
        }
        default:
          return { userId };
      }
    });

    try {
      return {
        kind: "ok",
        splits: computeSplits({ method, totalCents: amountCents, participants }),
      };
    } catch (splitError) {
      return {
        kind: "error",
        problem:
          splitError instanceof SplitError
            ? splitError.message
            : "Those splits do not add up.",
      };
    }
  }, [amountCents, method, selected, weights, currency]);

  function toggle(userId: string) {
    setSelected((current) =>
      current.includes(userId)
        ? current.filter((candidate) => candidate !== userId)
        : [...current, userId],
    );
  }

  function submit() {
    setError(null);
    setFieldErrors({});

    if (amountCents === null) {
      setFieldErrors({ amountCents: ["Enter an amount"] });
      return;
    }

    const participants = (preview && preview?.kind === "ok" ? preview.splits : []).map(
      (split) => ({
        userId: split.userId,
        // EXACT is the only method whose client amounts the server reads, and it
        // revalidates the sum before using them (§2.5).
        ...(method === "EXACT" ? { amountCents: split.amountCents } : {}),
        ...(method === "PERCENTAGE" ? { percentBps: split.percentBps ?? undefined } : {}),
        ...(method === "SHARES" ? { shares: split.shares ?? undefined } : {}),
      }),
    );

    startTransition(async () => {
      // The receipt is stored first, because the expense references it. If the
      // expense then fails to create, the upload is left unreferenced — which is
      // the harmless direction: a stray private blob nobody links to, rather
      // than an expense pointing at a receipt that was never stored.
      let receiptFileId: string | undefined;
      if (receipt) {
        const form = new FormData();
        form.set("householdId", householdId);
        form.set("file", receipt);
        const upload = await uploadReceiptAction(form);
        if (!upload.ok) {
          setError(upload.message);
          setFieldErrors(upload.fieldErrors ?? {});
          return;
        }
        receiptFileId = upload.data.fileId;
      }

      const result = await createExpense({
        householdId,
        paidByUserId,
        categoryId: categoryId === "" ? null : categoryId,
        description,
        amountCents,
        currency,
        date: new Date(`${date}T00:00:00.000Z`),
        splitMethod: method,
        participants,
        receiptFileId,
      });

      if (!result.ok) {
        setError(result.message);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      router.push(`/households/${householdId}`);
      router.refresh();
    });
  }

  const canSubmit =
    !isPending &&
    description.trim() !== "" &&
    amountCents !== null &&
    amountCents !== 0 &&
    preview?.kind === "ok";

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4">
        <Field label="Description" error={fieldErrors.description?.[0]}>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={200}
            placeholder="Groceries"
            className={inputClass}
          />
        </Field>

        <Field
          label={`Amount (${currency})`}
          error={
            fieldErrors.amountCents?.[0] ??
            (amountText !== "" && amountCents === null
              ? "That is not an amount"
              : undefined)
          }
        >
          <input
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            inputMode="decimal"
            placeholder="59.41"
            className={`${inputClass} font-mono tabular-nums`}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Category">
            <select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className={inputClass}
            >
              <option value="">None</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Receipt (optional)" error={fieldErrors.file?.[0]}>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(event) => setReceipt(event.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:text-sm file:font-medium dark:file:bg-slate-800 dark:file:text-slate-100"
          />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Stored privately — only members of this household can open it.
          </p>
        </Field>

        <Field label="Paid by">
          <select
            value={paidByUserId}
            onChange={(event) => setPaidByUserId(event.target.value)}
            className={inputClass}
          >
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.userId === viewerUserId ? "You" : member.name}
              </option>
            ))}
          </select>
        </Field>
      </Card>

      <Card className="space-y-4 p-4">
        <Field label="Split">
          <div className="grid grid-cols-2 gap-2">
            {METHODS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                onClick={() => setMethod(entry.value)}
                className={`min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors ${
                  method === entry.value
                    ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                    : "border-slate-300 dark:border-slate-700"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {METHODS.find((entry) => entry.value === method)!.hint}
          </p>
        </Field>

        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {members.map((member) => {
            const isOn = selected.includes(member.userId);
            const split =
              preview?.kind === "ok"
                ? preview.splits.find((candidate) => candidate.userId === member.userId)
                : undefined;
            return (
              <li key={member.userId} className="flex items-center gap-3 py-2">
                <input
                  id={`member-${member.userId}`}
                  type="checkbox"
                  checked={isOn}
                  onChange={() => toggle(member.userId)}
                  className="size-5 shrink-0 rounded"
                />
                <label
                  htmlFor={`member-${member.userId}`}
                  className="min-w-0 flex-1 truncate text-sm"
                >
                  {member.userId === viewerUserId ? "You" : member.name}
                  {member.isPlaceholder ? (
                    <span className="ml-1 text-xs text-slate-400">(tracked)</span>
                  ) : null}
                </label>

                {isOn && method !== "EQUAL" ? (
                  <input
                    value={weights[member.userId] ?? ""}
                    onChange={(event) =>
                      setWeights((current) => ({
                        ...current,
                        [member.userId]: event.target.value,
                      }))
                    }
                    inputMode="decimal"
                    placeholder={
                      method === "PERCENTAGE" ? "%" : method === "SHARES" ? "1" : "0.00"
                    }
                    className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right font-mono text-sm tabular-nums dark:border-slate-700 dark:bg-slate-950"
                  />
                ) : null}

                {isOn && split ? (
                  <span className="w-20 shrink-0 text-right font-mono text-sm text-slate-600 tabular-nums dark:text-slate-400">
                    {formatMoney(split.amountCents, currency)}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>

        {preview?.kind === "error" ? (
          <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
            {preview.problem}
          </p>
        ) : null}
      </Card>

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <Button onClick={submit} disabled={!canSubmit} className="w-full">
        {isPending ? "Adding…" : "Add expense"}
      </Button>

      {preview?.kind === "ok" ? (
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          Totals{" "}
          {formatMoney(
            preview.splits.reduce((sum, split) => sum + split.amountCents, 0),
            currency,
          )}{" "}
          across {preview.splits.length}{" "}
          {preview.splits.length === 1 ? "person" : "people"}
        </p>
      ) : null}
    </div>
  );
}

type Preview =
  { kind: "ok"; splits: ComputedSplit[] } | { kind: "error"; problem: string };

const inputClass =
  "w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950";

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
