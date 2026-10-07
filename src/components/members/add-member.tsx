"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { inviteMember } from "@/actions/households/invite";
import { addPlaceholderMember } from "@/actions/households/placeholders";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * The two ways to add somebody.
 *
 * "Track someone" is deliberately first and explained, because it is the one
 * people want and the less obvious of the two: it covers the flatmate who will
 * never sign up. Their shares count immediately, since there is nobody to
 * accept them (§8a).
 */
export function AddMember({ householdId }: { householdId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"tracked" | "invite">("tracked");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result =
        mode === "tracked"
          ? await addPlaceholderMember({ householdId, name })
          : await inviteMember({ householdId, email });

      if (!result.ok) {
        setError(result.message);
        return;
      }
      setName("");
      setEmail("");
      setMessage(
        mode === "tracked"
          ? "Added. Their share of new expenses counts straight away."
          : "Invitation sent. They will join once they open the link.",
      );
      router.refresh();
    });
  }

  return (
    <Card className="p-4">
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={mode === "tracked" ? "primary" : "secondary"}
          onClick={() => setMode("tracked")}
        >
          Track someone
        </Button>
        <Button
          type="button"
          variant={mode === "invite" ? "primary" : "secondary"}
          onClick={() => setMode("invite")}
        >
          Invite by email
        </Button>
      </div>

      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        {mode === "tracked"
          ? "For someone who will not sign up. You accept and confirm on their behalf, and their share counts as soon as you add an expense."
          : "They sign in with Google and accept their own shares. Nothing counts toward balances until they do."}
      </p>

      <div className="mt-3 flex gap-2">
        {mode === "tracked" ? (
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name"
            maxLength={60}
            className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        ) : (
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            inputMode="email"
            placeholder="name@example.com"
            className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        )}
        <Button
          onClick={submit}
          disabled={
            isPending || (mode === "tracked" ? name.trim() === "" : email.trim() === "")
          }
        >
          {isPending ? "…" : "Add"}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
          {message}
        </p>
      ) : null}
    </Card>
  );
}
