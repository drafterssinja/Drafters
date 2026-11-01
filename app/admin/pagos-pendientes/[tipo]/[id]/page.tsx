import { redirect } from 'next/navigation';

// 01/11 (Iñi): fuera las mesas con dinero y los pagos pendientes.
export default function Pagina() {
  redirect('/admin');
}
