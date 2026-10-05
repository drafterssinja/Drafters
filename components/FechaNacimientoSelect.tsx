'use client';

import * as S from '@/lib/mockupStyles';

// Selector de fecha de nacimiento con tres desplegables (día / mes / año).
// Sustituye al <input type="date"> (05/10): en algunos móviles Android — y
// sobre todo en los navegadores integrados de apps (Instagram, WhatsApp,
// etc.) — el calendario nativo no deja elegir el año de nacimiento o ni
// siquiera se abre. Tres <select> funcionan igual en cualquier navegador.
// Trabaja con el mismo formato que la base de datos: 'YYYY-MM-DD' ('' si falta
// alguna de las tres partes).
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function diasDelMes(anio: number, mes: number): number {
  if (!mes) return 31;
  return new Date(anio || 2000, mes, 0).getDate(); // año bisiesto por defecto si no hay año aún
}

export default function FechaNacimientoSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (valor: string) => void;
}) {
  const [a, m, d] = (value || '').split('-');
  const anio = Number(a) || 0;
  const mes = Number(m) || 0;
  const dia = Number(d) || 0;

  const anioActual = new Date().getFullYear();
  const anios: number[] = [];
  for (let y = anioActual - 14; y >= anioActual - 100; y--) anios.push(y);
  // Si el valor guardado cae fuera del rango (cuentas antiguas), lo añadimos
  // para que no se pierda ni se muestre vacío.
  if (anio && !anios.includes(anio)) anios.push(anio);
  anios.sort((x, y) => y - x);

  // Estado parcial: el padre solo recibe una fecha completa; mientras falte
  // alguna parte guardamos lo elegido con ceros ("2001-00-00") para no
  // perderlo y devolvemos '' en onChange hasta que esté completa.
  function emitir(nuevoAnio: number, nuevoMes: number, nuevoDia: number) {
    const maxDia = diasDelMes(nuevoAnio, nuevoMes);
    const diaOk = nuevoDia > maxDia ? maxDia : nuevoDia;
    if (nuevoAnio && nuevoMes && diaOk) {
      onChange(`${String(nuevoAnio).padStart(4, '0')}-${String(nuevoMes).padStart(2, '0')}-${String(diaOk).padStart(2, '0')}`);
    } else if (nuevoAnio || nuevoMes || diaOk) {
      onChange(`${String(nuevoAnio).padStart(4, '0')}-${String(nuevoMes).padStart(2, '0')}-${String(diaOk).padStart(2, '0')}`);
    } else {
      onChange('');
    }
  }

  const sel = { ...S.selectInput, padding: '13px 10px' };
  const dias = diasDelMes(anio, mes);

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <select aria-label="Día" value={dia || ''} onChange={(e) => emitir(anio, mes, Number(e.target.value))} style={{ ...sel, flex: '0 0 24%' }}>
        <option value="">Día</option>
        {Array.from({ length: dias }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
      <select aria-label="Mes" value={mes || ''} onChange={(e) => emitir(anio, Number(e.target.value), dia)} style={{ ...sel, flex: 1 }}>
        <option value="">Mes</option>
        {MESES.map((nombre, i) => (
          <option key={nombre} value={i + 1}>{nombre}</option>
        ))}
      </select>
      <select aria-label="Año" value={anio || ''} onChange={(e) => emitir(Number(e.target.value), mes, dia)} style={{ ...sel, flex: '0 0 28%' }}>
        <option value="">Año</option>
        {anios.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  );
}

// Una fecha 'YYYY-MM-DD' solo es válida si está completa (sin partes a cero).
export function fechaNacimientoCompleta(valor: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(valor || '');
}

export function esMayorDeEdad(valor: string, edadMinima = 18): boolean {
  if (!fechaNacimientoCompleta(valor)) return false;
  const [y, m, d] = valor.split('-').map(Number);
  const hoy = new Date();
  let edad = hoy.getFullYear() - y;
  if (hoy.getMonth() + 1 < m || (hoy.getMonth() + 1 === m && hoy.getDate() < d)) edad--;
  return edad >= edadMinima;
}
