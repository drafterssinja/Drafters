import { redirect } from 'next/navigation';

// 01/11 (Iñi): Drafters V2 pasa a ser Drafters. La portada de la versión anterior lleva a la nueva.
export default function Pagina() {
  redirect('/v2/futbol');
}
