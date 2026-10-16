'use client';

import { useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import Cargando from '@/components/Cargando';
import type { FilaAmigo } from '@/lib/amigos';

// Invitar a amigos de Drafters a esta sala (16/10, Iñi). Les llega una
// notificación con el enlace a la sala.
export default function InvitarAmigos({ amistosoId, dentro }: { amistosoId: string; dentro: string[] }) {
  const [abierto, setAbierto] = useState(false);
  const [amigos, setAmigos] = useState<FilaAmigo[] | null>(null);
  const [hecho, setHecho] = useState<Record<string, string>>({});

  async function abrir() {
    setAbierto(true);
    const { data } = await supabase.rpc('amigos_lista');
    setAmigos(((data as FilaAmigo[]) ?? []).filter((f) => f.estado === 'aceptada'));
  }

  async function invitar(f: FilaAmigo) {
    const { error } = await supabase.rpc('amistoso_invitar', { p_amistoso: amistosoId, p_usuario: f.usuario_id });
    setHecho((h) => ({ ...h, [f.usuario_id]: error ? error.message.replace(/^ERROR:\s*/i, '') : '✓ Invitado' }));
  }

  if (!abierto) {
    return (
      <button type="button" onClick={() => void abrir()} style={{ ...S.secondaryLinkButton, borderColor: 'rgba(122,167,255,0.5)', color: '#7AA7FF', marginTop: 0 }}>
        👥 Invitar a amigos de Drafters
      </button>
    );
  }
  return (
    <div style={{ border: '1px solid rgba(122,167,255,0.4)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: '#7AA7FF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Invitar a amigos</span>
      {amigos === null && <Cargando compacto />}
      {amigos?.length === 0 && (
        <span style={{ fontSize: 13, color: S.MUTED_3 }}>
          Todavía no tienes amigos en Drafters. <Link href="/amigos" style={{ color: '#7AA7FF' }}>Añádelos aquí</Link>.
        </span>
      )}
      {amigos?.map((f) => {
        const ya = dentro.includes(f.usuario_id);
        const estado = hecho[f.usuario_id];
        return (
          <div key={f.usuario_id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: S.TEXT }}>@{f.nombre_usuario}</span>
            {ya ? (
              <span style={{ fontSize: 12, color: S.MUTED_2 }}>Ya está dentro</span>
            ) : estado ? (
              <span style={{ fontSize: 12, color: estado.startsWith('✓') ? S.ACCENT : '#FF8A8A', maxWidth: 170, textAlign: 'right' }}>{estado}</span>
            ) : (
              <button type="button" onClick={() => void invitar(f)} style={{ width: 'auto', border: 'none', background: '#7AA7FF', color: '#0B0F0E', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
                Invitar
              </button>
            )}
          </div>
        );
      })}
      <button type="button" onClick={() => setAbierto(false)} style={{ ...S.secondaryLinkButton, marginTop: 0 }}>
        Cerrar
      </button>
    </div>
  );
}
