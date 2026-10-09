// 09/10 (Iñi): que en ningún sitio de la web se vea de dónde sacamos los datos.
// Los escudos del proveedor se reescriben a nuestro propio dominio
// (/escudos/...), servido por app/escudos/[archivo]/route.ts. Aquí no se
// nombra el dominio de origen para que no acabe en el JavaScript del navegador.
const RUTA_ESCUDOS = /^https?:\/\/[^/]+\/i\/teamlogos\/([a-z0-9_\-/]+\.png)/i;

export function urlEscudoPropia(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(RUTA_ESCUDOS);
  return m ? `/escudos/${m[1].split('/').join('--')}` : url;
}
