export function cn(...classes: string[]) {
  return classes.filter((c) => c !== "undefined" && c !== "").join(" ");
}