'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, Perfil } from '@/lib/supabaseClient';
import DraftersHeader from '@/components/DraftersHeader';
import * as S from '@/lib/mockupStyles';
import { conTiempoMaximo } from '@/lib/conTiempoMaximo';

// ============================================================================
// PUBLICIDAD EN VÍDEO — panel de admin (nuevo, 27/09, décima vuelta)
// ============================================================================
// Pantalla propia, mismo patrón que /admin/usuarios (no vive embebida en el
// panel principal de /admin — se llega pulsando la tarjeta "Vídeos
// publicitarios"). Gestiona la tabla `anuncios_video` (drafters-schema.sql):
// subir un vídeo nuevo al bucket de Storage "anuncios", fijar su prioridad
// (pedido de Iñi: "la frecuencia tiene que ser más o menos parecida" — el
// sorteo ponderado de elegir_anuncio_video() ya garantiza esto del lado del
// servidor, aquí solo se fija el número), en qué huecos sale (recarga,
// clasificación y/o Mesas Drafters — este hueco vivió primero, a modo de
// prueba, en el feed de /inicio, y desde el 28/09 vive en /mesas, ver
// drafters-schema.sql), activarlo/desactivarlo y,
// opcionalmente, una ventana de fechas — más las estadísticas de visualización de cada uno
// (estadisticas_anuncios_video()), para poder enseñarle el dato real a cada
// anunciante.
//
// Las filas de `anuncios_video` se leen/escriben directamente contra la
// tabla (no hace falta ninguna función RPC intermedia): su RLS
// ("anuncios_video_admin_todo") ya da acceso total al admin y ninguno al
// resto de usuarios — mismo patrón que `jugadores` o `rankings_mundiales`.
// Solo las estadísticas pasan por una función (estadisticas_anuncios_video())
// porque agregan la tabla de reproducciones, que sí tiene RLS de solo
// lectura para el admin.

type VideoRow = {
  id: string;
  nombre_referencia: string;
  url: string;
  prioridad: number;
  activo: boolean;
  mostrar_en_recarga: boolean;
  mostrar_en_clasificacion: boolean;
  mostrar_en_mesas: boolean;
  fecha_inicio: string;
  fecha_fin: string | null;
  creado_at: string;
  // A dónde lleva si alguien pulsa el vídeo (nuevo, 01/10) — null = no es clicable.
  enlace_destino: string | null;
};

// Separado en pasivas (clasificación en directo + Mesas Drafters, se
// reproducen solas) y recarga (el usuario elige activamente verlo a
// cambio de 20€) — pedido de Iñi, 28/09: son audiencias distintas para un
// anunciante, así que no tiene sentido enseñar un único número. `clics`
// (nuevo, 03/10, pedido de Iñi: "quiero que se quede registrado cuántas
// veces se pulsa encima del vídeo y se visita la página del publicitante")
// — cuántas veces se ha pulsado el vídeo para ir al enlace del anunciante,
// ver registrar_clic_anuncio() en drafters-schema.sql.
type EstadisticaVideo = {
  video_id: string;
  visualizaciones_pasivas: number;
  visualizaciones_recarga: number;
  total_visualizaciones: number;
  clics: number;
};

// Extrae la ruta dentro del bucket "anuncios" a partir de la URL pública
// (formato fijo de Supabase Storage: ".../object/public/anuncios/<ruta>")
// — solo se usa para poder borrar también el archivo de Storage al eliminar
// un vídeo; si por lo que sea no encaja el formato, se deja el archivo
// huérfano en Storage (no bloquea el borrado de la fila, que es lo que de
// verdad le importa al admin).
function rutaStorageDesdeUrl(url: string): string | null {
  const marcador = '/object/public/anuncios/';
  const i = url.indexOf(marcador);
  return i === -1 ? null : url.slice(i + marcador.length);
}

// Enlace al que lleva el vídeo si lo pulsan (nuevo, 01/10) — si Iñi escribe
// "miweb.com" sin "https://" delante, el navegador lo trataría como una ruta
// relativa dentro de Drafters en vez de salir a esa web, así que se le
// añade "https://" solo si hace falta. Vacío = sin enlace (el vídeo no es clicable).
function normalizarEnlace(valor: string): string | null {
  const v = valor.trim();
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}


export default function AdminPublicidadPage() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [errorAcceso, setErrorAcceso] = useState<string | null>(null);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [estadisticas, setEstadisticas] = useState<Map<string, EstadisticaVideo>>(new Map());
  const [error, setError] = useState<string | null>(null);

  // Formulario de subida.
  const [archivo, setArchivo] = useState<File | null>(null);
  const [nombreReferencia, setNombreReferencia] = useState('');
  const [prioridad, setPrioridad] = useState('0');
  const [activo, setActivo] = useState(true);
  const [mostrarEnRecarga, setMostrarEnRecarga] = useState(true);
  const [mostrarEnClasificacion, setMostrarEnClasificacion] = useState(true);
  const [mostrarEnMesas, setMostrarEnMesas] = useState(true);
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [enlaceDestino, setEnlaceDestino] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);

  async function cargarVideosYEstadisticas() {
    const [{ data: videosData, error: videosError }, { data: statsData, error: statsError }] = await Promise.all([
      supabase.from('anuncios_video').select('*').order('creado_at', { ascending: false }),
      supabase.rpc('estadisticas_anuncios_video'),
    ]);
    if (videosError) {
      setError('No se han podido cargar los vídeos publicitarios.');
      return;
    }
    setVideos((videosData as VideoRow[]) ?? []);
    // FIX 03/10 (aviso de Iñi: "se han perdido las estadísticas, está todo
    // a 0 cuando llevaban 160 visualizaciones"): este error se descartaba
    // en silencio — si la RPC fallaba por lo que fuera (lo más probable:
    // el SQL con los clics nuevos todavía no se había vuelto a ejecutar en
    // Supabase, o el caché de esquema de Supabase tardó en enterarse de la
    // función nueva), `statsData` quedaba vacío y TODAS las cifras se
    // veían a 0 — dando la falsa impresión de que las 160 visualizaciones
    // de antes se habían borrado, cuando en realidad las filas siguen
    // intactas en anuncios_video_reproducciones (esta función solo LEE esa
    // tabla, nunca la toca). Ahora, si la RPC falla, se ve un aviso real en
    // vez de dejar las cifras a 0 sin explicación.
    if (statsError) {
      setError(`No se han podido cargar las estadísticas de los vídeos: ${statsError.message}`);
    }
    setEstadisticas(new Map(((statsData as EstadisticaVideo[]) ?? []).map((s) => [s.video_id, s])));
  }

  useEffect(() => {
    let activo = true;

    async function cargar() {
      // 28/09: esta pantalla se quedaba a veces colgada en "Comprobando
      // acceso..." sin llegar a mostrar nada (aviso de Iñi) — si alguna de
      // estas llamadas fallaba o se quedaba sin responder, la pantalla se
      // quedaba en el estado de carga para siempre, porque nada capturaba
      // el error. Ahora todo el bloque va en un try/catch con un tiempo
      // máximo de espera (10s): si algo falla o tarda demasiado, se sale
      // del estado de "comprobando acceso" con un mensaje real en vez de
      // quedarse colgado sin explicación.
      try {
        const {
          data: { session },
        } = await conTiempoMaximo(supabase.auth.getSession(), 'comprobar la sesión');

        if (!activo) return;

        if (!session) {
          router.push('/login');
          return;
        }

        const { data: perfilData, error: perfilError } = await conTiempoMaximo(
          supabase.from('perfiles').select('*').eq('id', session.user.id).single(),
          'cargar tu perfil'
        );

        if (!activo) return;

        if (perfilError) {
          setErrorAcceso(`No se ha podido comprobar tu acceso: ${perfilError.message}`);
          return;
        }

        const p = perfilData as Perfil | null;
        if (!p || p.rol !== 'admin') {
          router.push('/cuenta');
          return;
        }

        setPerfil(p);
        setAutorizado(true);
        await cargarVideosYEstadisticas();
      } catch (e) {
        if (!activo) return;
        setErrorAcceso(e instanceof Error ? `No se ha podido comprobar tu acceso: ${e.message}` : 'No se ha podido comprobar tu acceso.');
      }
    }

    cargar();
    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const prioridadNum = useMemo(() => {
    const n = parseInt(prioridad, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }, [prioridad]);

  async function subirVideo() {
    setErrorSubida(null);
    if (!archivo) {
      setErrorSubida('Elige el archivo de vídeo.');
      return;
    }
    if (!nombreReferencia.trim()) {
      setErrorSubida('Ponle un nombre de referencia (para saber qué anunciante es).');
      return;
    }
    if (prioridadNum === null) {
      setErrorSubida('La prioridad tiene que ser un número de 0 o más.');
      return;
    }

    setSubiendo(true);

    const extension = archivo.name.includes('.') ? archivo.name.slice(archivo.name.lastIndexOf('.')) : '';
    const ruta = `${crypto.randomUUID()}${extension}`;

    const { error: subidaError } = await supabase.storage.from('anuncios').upload(ruta, archivo, { contentType: archivo.type || undefined });
    if (subidaError) {
      // Se muestra el mensaje real de Supabase (nuevo, tras el aviso de Iñi
      // de un 413/"exceeded the maximum allowed size" subiendo un vídeo de
      // 50MB) — antes era un texto genérico que no dejaba ver si el motivo
      // era el límite de tamaño del proyecto (el más probable, ver más abajo)
      // u otra cosa. El límite de tamaño de archivo es una configuración de
      // Supabase (Project Settings → Storage → "Global file size limit"),
      // no algo que dependa del código de esta pantalla: en el plan Free de
      // Supabase está fijado en 50 MB y no se puede subir sin pasar a un
      // plan de pago.
      setErrorSubida(`No se ha podido subir el archivo de vídeo: ${subidaError.message}. Si el vídeo pesa cerca de 50 MB o más, es probable que sea el límite de tamaño de tu proyecto de Supabase (Project Settings → Storage) — en el plan Free ese límite está fijado en 50 MB.`);
      setSubiendo(false);
      return;
    }

    const { data: urlData } = supabase.storage.from('anuncios').getPublicUrl(ruta);

    const { error: insertError } = await supabase.from('anuncios_video').insert({
      nombre_referencia: nombreReferencia.trim(),
      url: urlData.publicUrl,
      prioridad: prioridadNum,
      activo,
      mostrar_en_recarga: mostrarEnRecarga,
      mostrar_en_clasificacion: mostrarEnClasificacion,
      mostrar_en_mesas: mostrarEnMesas,
      fecha_inicio: fechaInicio ? new Date(fechaInicio).toISOString() : undefined,
      fecha_fin: fechaFin ? new Date(fechaFin).toISOString() : null,
      enlace_destino: normalizarEnlace(enlaceDestino),
    });

    setSubiendo(false);

    if (insertError) {
      setErrorSubida('El vídeo se subió, pero no se ha podido guardar en la lista. Inténtalo de nuevo.');
      return;
    }

    setArchivo(null);
    setNombreReferencia('');
    setPrioridad('0');
    setActivo(true);
    setMostrarEnRecarga(true);
    setMostrarEnClasificacion(true);
    setMostrarEnMesas(true);
    setFechaInicio('');
    setFechaFin('');
    setEnlaceDestino('');
    await cargarVideosYEstadisticas();
  }

  async function actualizarVideo(id: string, cambios: Partial<Pick<VideoRow, 'activo' | 'mostrar_en_recarga' | 'mostrar_en_clasificacion' | 'mostrar_en_mesas' | 'prioridad' | 'enlace_destino'>>) {
    // Optimista: se actualiza en pantalla al momento y, si el guardado
    // falla, se recarga la lista de verdad para no dejar la pantalla
    // mostrando algo que no se llegó a guardar.
    setVideos((prev) => prev.map((v) => (v.id === id ? { ...v, ...cambios } : v)));
    const { error: updateError } = await supabase.from('anuncios_video').update(cambios).eq('id', id);
    if (updateError) {
      setError('No se ha podido guardar el cambio. Se ha recargado la lista.');
      await cargarVideosYEstadisticas();
    }
  }

  async function eliminarVideo(video: VideoRow) {
    const ruta = rutaStorageDesdeUrl(video.url);
    if (ruta) {
      await supabase.storage.from('anuncios').remove([ruta]);
    }
    const { error: deleteError } = await supabase.from('anuncios_video').delete().eq('id', video.id);
    if (deleteError) {
      setError('No se ha podido eliminar el vídeo.');
      return;
    }
    setVideos((prev) => prev.filter((v) => v.id !== video.id));
  }

  if (errorAcceso) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader />
          <div style={S.accountSection}>
            <p style={S.errorText}>{errorAcceso}</p>
            <button
              type="button"
              onClick={() => {
                setErrorAcceso(null);
                setAutorizado(null);
                window.location.reload();
              }}
              style={S.primaryButton}
            >
              Reintentar
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (autorizado === null || !perfil) {
    return (
      <main style={S.mainReset}>
        <div style={S.pageFrame}>
          <DraftersHeader />
          <div style={S.accountSection}>
            <p style={{ fontSize: 14, color: S.MUTED_2 }}>Comprobando acceso...</p>
          </div>
        </div>
      </main>
    );
  }

  const saldoLabel = `${perfil.saldo_simulado.toFixed(2)} €`;
  const initials = S.iniciales(perfil.nombre, perfil.apellido);

  return (
    <main style={S.mainReset}>
      <div style={S.pageFrame}>
        <DraftersHeader saldoLabel={saldoLabel} accountInitials={initials} />
        <div style={S.accountSection}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.TEXT, fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>
              Vídeos publicitarios
            </h1>
            <p style={{ fontSize: 13, color: S.MUTED_2, margin: 0 }}>
              Se reparten entre los huecos marcados con un sorteo ponderado por prioridad — nunca deja a un vídeo activo casi
              sin verse, solo hace que uno con más prioridad salga más veces de media.
            </p>
          </div>

          {error && <p style={S.errorText}>{error}</p>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14 }}>
            <span style={S.sectionLabel}>Subir nuevo vídeo</span>

            <div style={S.field}>
              <span style={S.label}>Archivo de vídeo</span>
              <input
                type="file"
                accept="video/*"
                onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
                style={{ ...S.input, padding: '10px 12px' }}
              />
              {archivo && (
                <span style={{ fontSize: 11, color: archivo.size > 50 * 1024 * 1024 ? S.ERROR : S.MUTED_3 }}>
                  {(archivo.size / (1024 * 1024)).toFixed(1)} MB
                  {archivo.size > 50 * 1024 * 1024 && ' — puede que no se pueda subir: el plan Free de Supabase limita cada archivo a 50 MB (Project Settings → Storage, en tu proyecto de Supabase)'}
                </span>
              )}
            </div>

            <div style={S.field}>
              <span style={S.label}>Nombre de referencia (solo lo ves tú — qué anunciante es)</span>
              <input value={nombreReferencia} onChange={(e) => setNombreReferencia(e.target.value)} placeholder="p.ej. Marca X — campaña octubre" style={S.input} />
            </div>

            <div style={S.field}>
              <span style={S.label}>Prioridad (0 o más — cuanto más alto, más veces sale)</span>
              <input type="number" min={0} step={1} value={prioridad} onChange={(e) => setPrioridad(e.target.value)} style={{ ...S.input, width: 100 }} />
            </div>

            <div style={S.field}>
              <span style={S.label}>Enlace al pulsar el vídeo (opcional — déjalo en blanco si no quieres que sea clicable)</span>
              <input value={enlaceDestino} onChange={(e) => setEnlaceDestino(e.target.value)} placeholder="p.ej. miweb.com/promocion" style={S.input} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={S.label}>Dónde se muestra</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: S.TEXT, cursor: 'pointer', padding: '4px 0' }}>
                <input type="checkbox" checked={mostrarEnRecarga} onChange={(e) => setMostrarEnRecarga(e.target.checked)} style={{ width: 18, height: 18, flexShrink: 0, accentColor: S.ACCENT, cursor: 'pointer' }} />
                Recarga de saldo (ver vídeo a cambio de 20 €)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: S.TEXT, cursor: 'pointer', padding: '4px 0' }}>
                <input type="checkbox" checked={mostrarEnClasificacion} onChange={(e) => setMostrarEnClasificacion(e.target.checked)} style={{ width: 18, height: 18, flexShrink: 0, accentColor: S.ACCENT, cursor: 'pointer' }} />
                Clasificación en directo (debajo del contenido)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: S.TEXT, cursor: 'pointer', padding: '4px 0' }}>
                <input type="checkbox" checked={mostrarEnMesas} onChange={(e) => setMostrarEnMesas(e.target.checked)} style={{ width: 18, height: 18, flexShrink: 0, accentColor: S.ACCENT, cursor: 'pointer' }} />
                Mesas Drafters (entre tus mesas en juego y elegir deporte)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: S.TEXT, cursor: 'pointer', padding: '4px 0' }}>
                <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} style={{ width: 18, height: 18, flexShrink: 0, accentColor: S.ACCENT, cursor: 'pointer' }} />
                Activo desde ya
              </label>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ ...S.field, flex: 1 }}>
                <span style={S.label}>Empieza (opcional, si no ahora mismo)</span>
                <input type="datetime-local" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} style={S.input} />
              </div>
              <div style={{ ...S.field, flex: 1 }}>
                <span style={S.label}>Termina (opcional)</span>
                <input type="datetime-local" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} style={S.input} />
              </div>
            </div>

            {errorSubida && <p style={S.errorText}>{errorSubida}</p>}

            <button type="button" disabled={subiendo} onClick={subirVideo} style={{ ...S.primaryButton, opacity: subiendo ? 0.7 : 1 }}>
              {subiendo ? 'Subiendo...' : 'Subir vídeo'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={S.sectionLabel}>
              {videos.length} vídeo{videos.length === 1 ? '' : 's'}
            </span>
            {videos.length === 0 && <p style={{ fontSize: 12.5, color: S.MUTED_3, margin: 0 }}>Todavía no se ha subido ningún vídeo.</p>}

            {videos.map((v) => {
              const stats = estadisticas.get(v.id);
              return (
                <div key={v.id} style={{ display: 'flex', flexDirection: 'column', gap: 10, background: S.PANEL, border: `1px solid ${S.CARD_BORDER}`, borderRadius: 12, padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 13.5, color: S.TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {v.nombre_referencia}
                      </span>
                      <span style={{ fontSize: 11, color: S.MUTED_3 }}>
                        Prioridad {v.prioridad} · Subido el {new Date(v.creado_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => eliminarVideo(v)}
                      aria-label="Eliminar vídeo"
                      style={{ flexShrink: 0, background: 'transparent', border: `1px solid ${S.BORDER}`, borderRadius: 8, color: S.ERROR, width: 32, height: 32, cursor: 'pointer' }}
                    >
                      ×
                    </button>
                  </div>

                  <video src={v.url} controls muted style={{ width: '100%', maxHeight: 160, borderRadius: 10, background: '#000' }} />

                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11.5, color: S.MUTED_2 }}>
                      <span style={{ color: S.TEXT, fontWeight: 700 }}>{stats?.visualizaciones_pasivas ?? 0}</span> en la app (clasificación / Mesas Drafters)
                    </span>
                    <span style={{ fontSize: 11.5, color: S.MUTED_2 }}>
                      <span style={{ color: S.TEXT, fontWeight: 700 }}>{stats?.visualizaciones_recarga ?? 0}</span> por recarga de saldo
                    </span>
                    <span style={{ fontSize: 11.5, color: S.MUTED_3 }}>
                      <span style={{ color: S.TEXT, fontWeight: 700 }}>{stats?.total_visualizaciones ?? 0}</span> en total
                    </span>
                    {v.enlace_destino && (
                      <span style={{ fontSize: 11.5, color: S.ACCENT }}>
                        <span style={{ color: S.TEXT, fontWeight: 700 }}>{stats?.clics ?? 0}</span> clics al enlace del anunciante
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: S.TEXT, cursor: 'pointer', padding: '3px 0' }}>
                      <input
                        type="checkbox"
                        checked={v.activo}
                        onChange={(e) => actualizarVideo(v.id, { activo: e.target.checked })}
                        style={{ width: 16, height: 16, flexShrink: 0, accentColor: S.ACCENT, cursor: 'pointer' }}
                      />
                      Activo
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: S.TEXT, cursor: 'pointer', padding: '3px 0' }}>
                      <input
                        type="checkbox"
                        checked={v.mostrar_en_recarga}
                        onChange={(e) => actualizarVideo(v.id, { mostrar_en_recarga: e.target.checked })}
                        style={{ width: 16, height: 16, flexShrink: 0, accentColor: S.ACCENT, cursor: 'pointer' }}
                      />
                      Recarga de saldo
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: S.TEXT, cursor: 'pointer', padding: '3px 0' }}>
                      <input
                        type="checkbox"
                        checked={v.mostrar_en_clasificacion}
                        onChange={(e) => actualizarVideo(v.id, { mostrar_en_clasificacion: e.target.checked })}
                        style={{ width: 16, height: 16, flexShrink: 0, accentColor: S.ACCENT, cursor: 'pointer' }}
                      />
                      Clasificación en directo
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: S.TEXT, cursor: 'pointer', padding: '3px 0' }}>
                      <input
                        type="checkbox"
                        checked={v.mostrar_en_mesas}
                        onChange={(e) => actualizarVideo(v.id, { mostrar_en_mesas: e.target.checked })}
                        style={{ width: 16, height: 16, flexShrink: 0, accentColor: S.ACCENT, cursor: 'pointer' }}
                      />
                      Mesas Drafters
                    </label>
                  </div>

                  <div style={{ display: 'flex', gap: 10 }}>
                    <div style={S.field}>
                      <span style={S.label}>Prioridad</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        defaultValue={v.prioridad}
                        onBlur={(e) => {
                          const n = parseInt(e.target.value, 10);
                          if (Number.isFinite(n) && n >= 0 && n !== v.prioridad) actualizarVideo(v.id, { prioridad: n });
                        }}
                        style={{ ...S.input, width: 100 }}
                      />
                    </div>
                    <div style={{ ...S.field, flex: 1 }}>
                      <span style={S.label}>Enlace al pulsar el vídeo (opcional)</span>
                      <input
                        defaultValue={v.enlace_destino ?? ''}
                        placeholder="p.ej. miweb.com/promocion"
                        onBlur={(e) => {
                          const normalizado = normalizarEnlace(e.target.value);
                          if (normalizado !== v.enlace_destino) actualizarVideo(v.id, { enlace_destino: normalizado });
                        }}
                        style={S.input}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}
