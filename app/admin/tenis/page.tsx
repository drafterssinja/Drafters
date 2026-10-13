'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';

// Diagnóstico de Live Tennis API (13/10). Botones con las llamadas útiles y la
// respuesta cruda debajo, para copiarla y pasársela a Claude.
const ATAJOS: { etiqueta: string; ruta: string }[] = [
  { etiqueta: 'Consumo / plan', ruta: '/usage' },
  { etiqueta: 'Partidos en juego', ruta: '/matches?status=live' },
  { etiqueta: 'Partidos (lista)', ruta: '/matches' },
  { etiqueta: 'Torneos', ruta: '/tournaments' },
  { etiqueta: 'Próximos partidos', ruta: '/fixtures' },
];

export default function AdminTenisPage() {
  const router = useRouter();
  const [autorizado, setAutorizado] = useState(false);
  const [ruta, setRuta] = useState('/usage');
  const [salida, setSalida] = useState<string>('');
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.push('/login');
      const { data } = await supabase.from('perfiles').select('rol').eq('id', session.user.id).single();
      if (!data || data.rol !== 'admin') return router.push('/cuenta');
      setAutorizado(true);
    })();
  }, [router]);

  async function probar(r: string) {
    setRuta(r);
    setCargando(true);
    setSalida('');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      const res = await fetch('/api/admin/probar-tenis', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruta: r }),
      });
      setSalida(JSON.stringify(await res.json(), null, 2));
    } catch (e) {
      setSalida(String(e));
    }
    setCargando(false);
  }

  if (!autorizado) return null;

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader sinVolver />
        <div style={{ ...S.accountSection, gap: 12 }}>
          <Link href="/admin" style={{ fontSize: 12, color: S.MUTED_2, textDecoration: 'none' }}>← Panel de administración</Link>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>Probar Live Tennis API</h1>
          <p style={{ fontSize: 12.5, color: S.MUTED_2, margin: 0 }}>
            Pulsa un botón y copia la respuesta. Para ver un partido concreto, escribe su ruta (p. ej. /matches/ID/score, /matches/ID/events, /matches/ID/statistics).
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ATAJOS.map((a) => (
              <button key={a.ruta} type="button" onClick={() => probar(a.ruta)} style={{ ...S.secondaryLinkButton, width: 'auto', padding: '8px 12px', fontSize: 12 }}>
                {a.etiqueta}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={ruta} onChange={(e) => setRuta(e.target.value)} style={{ ...S.input, flex: 1 }} />
            <button type="button" onClick={() => probar(ruta)} style={{ ...S.secondaryLinkButton, width: 'auto', padding: '8px 14px' }}>
              {cargando ? '…' : 'Probar'}
            </button>
          </div>
          <textarea readOnly value={salida} style={{ ...S.input, minHeight: 380, fontFamily: 'monospace', fontSize: 11 }} />
        </div>
      </div>
    </main>
  );
}
