import { Suspense } from "react";
import { AdultDeclarationScreen } from "../../../features/auth/adult-declaration";

export default function Page() {
  return <Suspense fallback={<p role="status">Beyan durumu yükleniyor…</p>}><AdultDeclarationScreen /></Suspense>;
}
