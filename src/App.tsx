export function App() {
  return (
    <main className="min-h-screen bg-[#0b1120] text-slate-100 flex items-center justify-center p-6">
      <div className="max-w-lg w-full rounded-2xl border border-[#334155] bg-[#0f172a] p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-3">
          <span className="h-3 w-3 rounded-full bg-[#10b981]" />
          <h1 className="text-lg font-semibold tracking-tight text-white">
            MC Launcher Rust
          </h1>
        </div>
        <p className="text-sm text-slate-400">
          Shell inicial de Tauri v2 + React 19 listo.
        </p>
      </div>
    </main>
  );
}

export default App;
