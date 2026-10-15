'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import * as S from '@/lib/mockupStyles';
import { Panel, V2_COLOR } from '@/components/v2/MarcoV2';
import { IconoCandado, type DeporteV2 } from '@/components/v2/IconosV2';
import { MODALIDAD_LABEL, cadaXSegundos, fechaCorta, mensajeError, resumenPremio, type Modalidad, type Premio } from '@/lib/v2';

// Amistosos de un deporte: mis salas, las públicas abiertas, entrar con código y crear.
type FilaLista = {
  id: string;
  nombre: string;
  deporte: string;
  modalidad: Modalidad;
  num_jugadores: number;
  privada: boolean;
  estado: string;
  creador: string;
  inscritos: number;
  soy_participante: boolean;
  competiciones: string[];
  cierre: string | null;
  premio: Premio | null;
};

export default function ListaAmistosos({ deporte }: { deporte: DeporteV2 }) {
  const router = useRouter();
  const [lista, setLista] = useState<FilaLista[] | null>(null);
  const [pestana, setPestana] = useState<'mias' | 'publicas' | null>(null);
  const [codigo, setCodigo] = useState('');
  const [errorCodigo, setErrorCodigo] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data } = await supabase.rpc('amistosos_v2_lista');
    setLista(((data as FilaLista[]) ?? []).filter((a) => a.deporte === deporte));
  }, [deporte]);

  useEffect(() => {
    void cargar();
    return cadaXSegundos(cargar, 15);
  }, [cargar]);

  const mias = (lista ?? []).filter((l) => l.soy_participante);
  const publicas = (lista ?? []).filter((l) => !l.soy_participante).sort((a, b) => b.inscritos / b.num_jugadores - a.inscritos / a.num_jugadores);
  const vista = pestana ?? (lista && mias.length === 0 ? 'publicas' : 'mias');
  const mostradas = vista === 'mias' ? mias : publicas;

  async function buscarCodigo() {
    setErrorCodigo(null);
    const c = codigo.trim().toUpperCase();
    if (c.length < 4) return setErrorCodigo('Escribe el código de la sala.');
    const { data, error } = await supabase.from('amistosos').select('id').eq('codigo', c).maybeSingle();
    if (error) return setErrorCodigo(mensajeError(error));
    if (!data) return setErrorCodigo('No hay ninguna sala con ese código.');
    router.push(`/v2/sala/${(data as { id: string }).id}`);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Link href={`/v2/crear?deporte=${deporte}`} style={{ ...S.primaryButton, background: V2_COLOR, textAlign: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 0 }}>
        + Crear un amistoso
      </Link>

      <Panel>
        <span style={S.sectionLabel}>¿Te han pasado un código?</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="Ej. 7F3K9A" maxLength={6} style={{ ...S.input, flex: 1, letterSpacing: '0.2em', fontWeight: 700 }} />
          <button type="button" onClick={buscarCodigo} style={{ ...S.secondaryLinkButton, width: 'auto', padding: '0 16px' }}>
            Entrar
          </button>
        </div>
        {errorCodigo && <p style={S.errorText}>{errorCodigo}</p>}
      </Panel>

      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" style={S.pill(vista === 'mias')} onClick={() => setPestana('mias')}>
          Mis amistosos ({mias.length})
        </button>
        <button type="button" style={S.pill(vista === 'publicas')} onClick={() => setPestana('publicas')}>
          Públicos ({publicas.length})
        </button>
      </div>

      {lista === null && <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>Cargando...</p>}
      {lista !== null && mostradas.length === 0 && (
        <p style={{ fontSize: 13, color: S.MUTED_3, margin: 0 }}>{vista === 'mias' ? 'Todavía no estás en ningún amistoso. Crea uno o únete a uno público.' : 'No hay amistosos públicos abiertos ahora mismo. ¡Crea el primero!'}</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {mostradas.map((a) => {
          const llena = a.inscritos >= a.num_jugadores;
          return (
            <Link key={a.id} href={`/v2/sala/${a.id}`} style={{ ...S.card, flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  {a.privada && <IconoCandado size={14} />}
                  <span style={{ fontWeight: 700, fontSize: 14.5, color: S.TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nombre}</span>
                </span>
                <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: llena ? '#F0B94D' : S.ACCENT }}>
                  {a.inscritos}/{a.num_jugadores}
                </span>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#F0B94D', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {a.competiciones.length > 1 ? `${a.competiciones[0]} → ${a.competiciones[a.competiciones.length - 1].replace(/^.* - /, '')}` : a.competiciones[0]}
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11.5, color: S.MUTED_2 }}>
                <span style={{ color: V2_COLOR, fontWeight: 700 }}>{MODALIDAD_LABEL[a.modalidad]}</span>
                {/* 15/10 (Iñi): el creador solo se enseña en las privadas (con el candado). */}
                {a.privada && <span>· creada por @{a.creador}</span>}
                {a.cierre && <span>· empieza {fechaCorta(a.cierre)}</span>}
              </div>
              {(a.privada || (a.premio && a.premio.tipo !== 'nada')) && <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>🏆 {resumenPremio(a.premio)}</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
