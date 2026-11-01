import { redirect } from 'next/navigation';

// 01/11 (Iñi): Drafters V2 pasa a ser Drafters. Las porras están en Golf → Porras.
export default function Pagina() {
  redirect('/v2/golf?modo=porras');
}
