import path from "node:path";

// Lexical validation only; binding still requires canonical containment.
export function isWorkspaceRoot(
  root: unknown,
  paths: Pick<typeof path, "isAbsolute" | "normalize" | "sep"> = path
): root is string {
  if (typeof root !== "string" || root.length === 0 ||
      !paths.isAbsolute(root) || paths.normalize(root) !== root) return false;
  if (paths.sep !== "\\") return true;
  if (/^[A-Za-z]:\\/.test(root)) return true;
  const unc = /^\\\\([^\\/:*?"<>|\u0000-\u001f]+)\\([^\\/:*?"<>|\u0000-\u001f]+)\\/.exec(root);
  return unc !== null && ![".", ".."].includes(unc[1]!) && ![".", ".."].includes(unc[2]!);
}
