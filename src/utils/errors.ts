import type { IpcErrorPayload } from "../types/launcher";

export function extractIpcError(err: unknown): IpcErrorPayload {
  if (typeof err === "object" && err !== null) {
    const candidate = err as IpcErrorPayload & { message?: unknown };
    return {
      code: typeof candidate.code === "string" ? candidate.code : undefined,
      message:
        typeof candidate.message === "string" ? candidate.message : undefined,
      required_major:
        typeof candidate.required_major === "number"
          ? candidate.required_major
          : undefined,
    };
  }
  if (typeof err === "string") {
    try {
      return JSON.parse(err) as IpcErrorPayload;
    } catch {
      return { message: err };
    }
  }
  return {};
}

function stripTechnicalPrefix(raw: string): string {
  return raw
    .replace(/^Configuration error:\s*/i, "")
    .replace(/^Content management error:\s*/i, "")
    .replace(/^Mod loader error:\s*/i, "")
    .replace(/^Manifest error:\s*/i, "")
    .replace(/^Process launch failed:\s*/i, "")
    .trim();
}

export function formatFriendlyError(
  err: unknown,
  fallback = "Ha ocurrido un error inesperado. Inténtalo de nuevo.",
): string {
  const parsed = extractIpcError(err);
  const rawMessage = parsed.message?.trim() ?? "";
  const cleanMessage = stripTechnicalPrefix(rawMessage);
  const lower = cleanMessage.toLowerCase();

  switch (parsed.code) {
    case "NETWORK_ERROR":
      return "No se pudo conectar a internet. Comprueba tu conexión e inténtalo de nuevo.";
    case "IO_ERROR":
      return "No se pudo leer o guardar un archivo en el disco. Comprueba que tienes espacio y permisos suficientes.";
    case "JSON_ERROR":
      return "Uno de los archivos de datos está dañado o incompleto. Inténtalo de nuevo.";
    case "ZIP_ERROR":
      return "El archivo comprimido está dañado o no es un archivo ZIP válido.";
    case "INTEGRITY_MISMATCH":
      return "Un archivo descargado no pasó la comprobación de seguridad. Inténtalo de nuevo.";
    case "JAVA_NOT_FOUND":
      return parsed.required_major
        ? `Esta versión de Minecraft necesita Java ${parsed.required_major}.`
        : "Falta la versión de Java necesaria para abrir Minecraft.";
    case "MANIFEST_ERROR":
      if (lower.includes("not found")) {
        return "No se encontró esa versión de Minecraft. Elige una versión oficial de la lista.";
      }
      if (lower.includes("invalid minecraft version")) {
        return "La versión de Minecraft escrita no es válida. Elige una versión de la lista.";
      }
      return "No se pudo cargar la información de esta versión de Minecraft.";
    case "PROCESS_LAUNCH_ERROR":
      if (lower.includes("already running")) {
        return "Esta instancia ya está abierta.";
      }
      if (lower.includes("explorer")) {
        return "No se pudo abrir la carpeta en el Explorador de Windows.";
      }
      return "No se pudo abrir Minecraft. Revisa los ajustes de la instancia o la consola de diagnóstico.";
    case "WIN32_ERROR":
      return "No se pudo aplicar la configuración de prioridad en Windows.";
    case "LOADER_ERROR":
      return "Este tipo de instalación todavía no está disponible. Cambia a Vanilla o Fabric para jugar.";
    case "CONFIG_ERROR":
    case "CONTENT_ERROR":
      if (
        cleanMessage &&
        !lower.includes("reqwest") &&
        !lower.includes("os error") &&
        !lower.includes("task failed") &&
        !lower.includes("not found") &&
        !lower.includes("invalid ") &&
        !lower.includes("incompatible extension") &&
        !lower.includes("failed to ")
      ) {
        return cleanMessage;
      }
      if (lower.includes("incompatible extension")) {
        return "Este archivo no es compatible. Usa archivos .jar para mods o .zip para packs y shaders.";
      }
      if (lower.includes("profile") && lower.includes("not found")) {
        return "No se encontró la instancia seleccionada.";
      }
      if (lower.includes("not found")) {
        return "No se encontró el archivo solicitado.";
      }
      return fallback;
    default:
      if (
        cleanMessage &&
        !lower.includes("reqwest") &&
        !lower.includes("error sending request") &&
        !lower.includes("dns error") &&
        !lower.includes("ipc")
      ) {
        return cleanMessage;
      }
      return fallback;
  }
}
