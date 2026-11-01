import { redirect } from 'next/navigation';

// 01/11 (Iñi): Drafters V2 pasa a ser Drafters. Las mesas de la versión anterior (con dinero) ya no existen.
export default function Pagina() {
  redirect('/v2/futbol');
}
