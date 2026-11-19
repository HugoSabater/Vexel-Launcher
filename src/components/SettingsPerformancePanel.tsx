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
      ((recommendedMb - 1024) / Math.max(1024, hardware.max_safe_ram_mb - 1024)) *
        100,
    ),
  );

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[#334155] bg-[#0f172a] p-6 space-y-5">
        <div className="flex items-center gap-2 border-b border-[#334155] pb-3">
          <Gauge className="h-4 w-4 text-[#38bdf8]" />
          <h3 className="text-sm font-semibold text-white">
            Tuning JVM y Memoria del Perfil ({profile.name})
          </h3>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-300">
              RAM Asignada al Heap (-Xms / -Xmx)
            </span>
            <span className="font-mono font-bold text-[#38bdf8]">
              {profile.ram_mb} MB
            </span>
          </div>

          <div className="relative pt-1 pb-5">
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
              className="w-full accent-[#10b981]"
            />
            <div
              className="absolute top-6 -translate-x-1/2 flex flex-col items-center pointer-events-none"
              style={{ left: `${recommendedPct}%` }}
            >
              <span className="h-2 w-0.5 bg-[#38bdf8]" />
              <span className="text-[10px] font-mono text-[#38bdf8] whitespace-nowrap">
                Óptimo: {recommendedMb} MB
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Estrategia de Garbage Collector
            </label>
            <select
              value={profile.gc_preset}
              onChange={(e) =>
                void onUpdateProfile({
                  ...profile,
                  gc_preset: e.target.value as GcPreset,
                })
              }
              className="w-full rounded-xl border border-[#334155] bg-[#0b1120] px-3 py-2.5 text-sm text-white focus:border-[#38bdf8] focus:outline-none"
            >
              <option value="generational_zgc">
                Generational ZGC (Pausas &lt;1ms, Java 21+)
              </option>
              <option value="aikar_g1_gc">
                Aikar&apos;s G1GC (Estable Java 8/17/21)
              </option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Servidor Directo QuickPlay (IP:Puerto)
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
              placeholder="Ej. play.servidor.net:25565"
              className="w-full rounded-xl border border-[#334155] bg-[#0b1120] px-3 py-2.5 text-sm font-mono text-white focus:border-[#38bdf8] focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[#334155] bg-[#0f172a] p-6 space-y-5">
        <div className="flex items-center gap-2 border-b border-[#334155] pb-3">
          <Shield className="h-4 w-4 text-[#10b981]" />
          <h3 className="text-sm font-semibold text-white">
            Cuenta Offline y Optimización de Sistema Operativo
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300 mb-1.5">
              <User className="h-3.5 w-3.5 text-[#38bdf8]" />
              Nombre de Jugador (Offline UUID v3)
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
              className="w-full rounded-xl border border-[#334155] bg-[#0b1120] px-3 py-2.5 text-sm text-white focus:border-[#38bdf8] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Prioridad de Proceso en Windows (Win32)
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
              className="w-full rounded-xl border border-[#334155] bg-[#0b1120] px-3 py-2.5 text-sm text-white focus:border-[#38bdf8] focus:outline-none"
            >
              <option value="normal">Normal</option>
              <option value="above_normal">
                Above Normal (Recomendado)
              </option>
              <option value="high">High Priority</option>
            </select>
          </div>
        </div>

        <label className="flex items-center justify-between rounded-xl border border-[#334155] bg-[#0b1120] p-4 cursor-pointer">
          <div>
            <div className="text-sm font-medium text-white">
              Modo Cero Overhead (Ocultar launcher al jugar)
            </div>
            <div className="text-xs text-slate-400">
              Oculta la ventana WebView2 al arrancar Minecraft para liberar el
              100% de RAM y GPU del launcher.
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
            className="h-5 w-5 accent-[#10b981]"
          />
        </label>

        <div className="rounded-xl border border-[#334155] bg-[#0b1120] p-3.5 flex items-start gap-2.5 text-xs text-slate-400">
          <HardDrive className="h-4 w-4 text-[#38bdf8] shrink-0 mt-0.5" />
          <div className="min-w-0">
            <span className="font-semibold text-slate-200">
              Directorio de Datos Híbrido Portable:
            </span>{" "}
            <span className="font-mono break-all text-slate-400">
              {dataRoot}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
