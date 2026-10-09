// 09/10 (Iñi): en la web no debe verse de dónde salen los datos. Los escudos
// se piden a nuestro dominio (/api/escudo?f=soccer--500--83.png) y el servidor
// los trae del origen; después quedan en la caché del CDN de Vercel.
// (Antes estaba en app/escudos/[...ruta] y luego [archivo]: daba problemas al
// subir la carpeta app por la web de GitHub, así que ahora es una ruta sin corchetes.)
const ORIGEN_ESCUDOS = 'https://a.espncdn.com/i/teamlogos/'; // solo en el servidor

export const runtime = 'edge';

export async function GET(req: Request) {
  const f = new URL(req.url).searchParams.get('f') ?? '';
  const ruta = f.split('--').join('/');
  if (!/^[a-z0-9_\-/]+\.png$/i.test(ruta) || ruta.includes('..')) return new Response('No encontrado', { status: 404 });
  const res = await fetch(`${ORIGEN_ESCUDOS}${ruta}`, { cache: 'force-cache' });
  if (!res.ok || !res.body) return new Response('No encontrado', { status: 404 });
  return new Response(res.body, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable' },
  });
}
