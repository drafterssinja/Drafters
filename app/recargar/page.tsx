import { redirect } from 'next/navigation';

// 01/11 (Iñi): ya no hay saldo en euros en Drafters. Si una porra se juega
// con dinero, la cantidad se ve en la propia porra, solo como información.
export default function Recargar() {
  redirect('/v2/futbol');
}
