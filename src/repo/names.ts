/** A component's name as a file or export name: `hero section` becomes `HeroSection`. */
export function pascalCase(text: string): string {
  const name = text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(part => part[0]!.toUpperCase() + part.slice(1))
    .join('');
  return /^[A-Za-z]/.test(name) ? name : `Section${name}`;
}
