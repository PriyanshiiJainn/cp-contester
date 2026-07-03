import { ContestApp } from "./contest-app";

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-xl font-bold">
          CP <span className="text-[#0b5da8]">Contester</span>
        </h1>
        <span className="cf-muted text-xs">
          unofficial Codeforces virtual contests — solve on codeforces.com
        </span>
      </div>
      <ContestApp />
    </main>
  );
}
