import { Gauge, HardDrive, Shield, User } from "lucide-react";
import type {
  GcPreset,
  HardwareInfo,
  LauncherConfig,
  ProcessPriority,
  Profile,
} from "../types/launcher";

interface SettingsPerformancePanelProps {
  profile: Profile;
  config: LauncherConfig;
  hardware: HardwareInfo;
  dataRoot: string;
  onUpdateProfile: (updated: Profile) => Promise<void>;
  onSaveGlobalSettings: (
    username: string,
    priority: ProcessPriority,
    closeOnLaunch: boolean,
  ) => Promise<void>;
}

export function SettingsPerformancePanel({
  profile,
  config,
  hardware,
  dataRoot,
  onUpdateProfile,
  onSaveGlobalSettings,
}: SettingsPerformancePanelProps) {
  const recommendedMb =
    profile.loader === "vanilla"
      ? hardware.recommended_vanilla_mb
      : hardware.recommended_modded_mb;

  const recommendedPct = Math.min(
    100,
    Math.max(
      0,
      ((recommendedMb - 1024) /
        Math.max(1024, hardware.max_safe_ram_mb - 1024)) *
        100,
    ),
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl obsidian-card p-5 space-y-5">
        <div className="flex items-center justify-between border-b border-white/[0.07] pb-3">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-[#38bdf8]" />
            <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-200">
              JVM & Memory Tuning · {profile.name}
            </h3>
          </div>
          <span className="text-[11px] font-mono text-slate-500">
            host max safe: {hardware.max_safe_ram_mb} MB
          </span>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300">
              Heap Allocation (<code className="text-slate-400">-Xms/-Xmx</code>)
            </span>
            <span className="font-mono font-semibold text-[#38bdf8]">
              {profile.ram_mb} MB
            </span>
          </div>

          <div className="relative pt-1 pb-6">
            <input
              type="range"
              min={1024}
              max={hardware.max_safe_ram_mb}
              step={512}
              value={profile.ram_mb}
              onChange={(e) =>
                void onUpdateProfile({
                  ...profile,
                  ram_mb: Number(e.target.value),
                })
              }
              className="w-full obsidian-slider"
            />
            <div
              className="absolute top-6 -translate-x-1/2 flex flex-col items-center pointer-events-none"
              style={{ left: `${recommendedPct}%` }}
            >
              <span className="h-1.5 w-px bg-[#38bdf8]" />
              <span className="text-[10px] font-mono text-[#38bdf8] whitespace-nowrap">
                auto: {recommendedMb} MB
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
              Garbage Collector Strategy
            </label>
            <select
              value={profile.gc_preset}
              onChange={(e) =>
                void onUpdateProfile({
                  ...profile,
                  gc_preset: e.target.value as GcPreset,
                })
              }
              className="w-full rounded-xl border border-white/[0.08] bg-[#090b10] px-3 py-2 text-xs text-white focus:border-[#38bdf8] focus:outline-none"
            >
              <option value="generational_zgc">
                Generational ZGC (&lt;1ms pauses, Java 21+)
              </option>
              <option value="aikar_g1_gc">
                Aikar&apos;s G1GC (Java 8 / 17 / 21)
              </option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
              Direct Server QuickPlay (IP:Port)
            </label>
            <input
              type="text"
              value={profile.server_address ?? ""}
              onChange={(e) =>
                void onUpdateProfile({
                  ...profile,
                  server_address: e.target.value.trim()
                    ? e.target.value.trim()
                    : null,
                })
              }
              placeholder="play.servidor.net:25565"
              className="w-full rounded-xl border border-white/[0.08] bg-[#090b10] px-3 py-2 text-xs font-mono text-white placeholder:text-slate-600 focus:border-[#38bdf8] focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl obsidian-card p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-white/[0.07] pb-3">
          <Shield className="h-4 w-4 text-[#10b981]" />
          <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-200">
            Offline Identity & OS Scheduling
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 mb-1.5">
              <User className="h-3.5 w-3.5 text-[#38bdf8]" />
              Offline Username (Deterministic UUID v3)
            </label>
            <input
              type="text"
              value={config.offline_username}
              onChange={(e) =>
                void onSaveGlobalSettings(
                  e.target.value,
                  config.process_priority,
                  config.close_on_launch,
                )
              }
              className="w-full rounded-xl border border-white/[0.08] bg-[#090b10] px-3 py-2 text-xs font-mono text-white focus:border-[#38bdf8] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
              Windows Process Priority (Win32)
            </label>
            <select
              value={config.process_priority}
              onChange={(e) =>
                void onSaveGlobalSettings(
                  config.offline_username,
                  e.target.value as ProcessPriority,
                  config.close_on_launch,
                )
              }
              className="w-full rounded-xl border border-white/[0.08] bg-[#090b10] px-3 py-2 text-xs text-white focus:border-[#38bdf8] focus:outline-none"
            >
              <option value="normal">Normal</option>
              <option value="above_normal">Above Normal (Recommended)</option>
              <option value="high">High Priority</option>
            </select>
          </div>
        </div>

        <label className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-[#090b10]/80 px-4 py-3 cursor-pointer">
          <div>
            <div className="text-xs font-medium text-white">
              Zero-Overhead Mode (Hide launcher on game start)
            </div>
            <div className="text-[11px] text-slate-500">
              Oculta WebView2 al confirmar el arranque de javaw.exe para liberar
              RAM y GPU.
            </div>
          </div>
          <input
            type="checkbox"
            checked={config.close_on_launch}
            onChange={(e) =>
              void onSaveGlobalSettings(
                config.offline_username,
                config.process_priority,
                e.target.checked,
              )
            }
            className="h-4 w-4 accent-[#10b981]"
          />
        </label>

        <div className="rounded-xl border border-white/[0.07] bg-[#06080d] px-3.5 py-2.5 flex items-start gap-2.5 text-[11px] text-slate-400">
          <HardDrive className="h-3.5 w-3.5 text-[#38bdf8] shrink-0 mt-0.5" />
          <div className="min-w-0">
            <span className="font-medium text-slate-300">
              Hybrid Data Root:
            </span>{" "}
            <span className="font-mono break-all text-slate-500">
              {dataRoot}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
