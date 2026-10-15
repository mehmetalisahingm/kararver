"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useProduct } from "../../components/product-provider";
import { safeReturnTo } from "../../lib/model";
import {
  makeWelcomeDraft,
  markWelcomeSeen,
  writeWelcomeDraft,
  type WelcomeDemoChoice,
} from "../../lib/welcome-draft";
import { Welcome } from "./welcome";

type Category = { id: string; name: string };

export function WelcomeEntry({ returnTo = "/", onExplore }: { returnTo?: string; onExplore?: () => void }) {
  const { client } = useProduct();
  const router = useRouter();
  const destination = safeReturnTo(returnTo);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    client.getCategories()
      .then((items) => {
        if (!active) return;
        setCategories(items.map(({ id, name }) => ({ id, name })));
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [client, attempt]);

  function continueTo(
    mode: "giris" | "kayit",
    payload: { categoryIds: string[]; demoChoice: WelcomeDemoChoice | null },
  ) {
    const draft = makeWelcomeDraft({ ...payload, returnTo: destination });
    writeWelcomeDraft(draft);
    markWelcomeSeen();
    router.push(`/${mode}?onboarding=1&returnTo=${encodeURIComponent(destination)}`);
  }

  return (
    <Welcome
      categories={categories}
      categoriesLoading={loading}
      categoriesError={error}
      onRetryCategories={() => setAttempt((value) => value + 1)}
      onComplete={(payload) => continueTo("giris", payload)}
      onRegister={(payload) => continueTo("kayit", payload)}
      onSkip={() => continueTo("giris", { categoryIds: [], demoChoice: null })}
      onExplore={(payload) => {
        if (payload.categoryIds.length || payload.demoChoice) writeWelcomeDraft(makeWelcomeDraft({ ...payload, returnTo: destination }));
        markWelcomeSeen();
        if (onExplore) onExplore();
        else router.push(destination);
      }}
    />
  );
}

