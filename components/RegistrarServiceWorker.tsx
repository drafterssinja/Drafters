'use client';

import { leerPreferenciaSonido, reproducirSonidoAviso } from '@/lib/sonidoAviso';

import { useEffect } from 'react';
import { registrarAperturaSiToca, registrarEntradaConSesionGuardada, registrarUsoApp } from '@/lib/usoApp';
import { supabase } from '@/lib/supabaseClient';

// Registra public/sw.js (necesario para que Android ofrezca instalar la app)
// y guarda el aviso de instalación de Android (beforeinstallprompt), que el
// navegador lanza una sola vez al cargar — así el botón "Añadir a Android"
// lo tiene disponible aunque se pinte más tarde (ver InstalarApp.tsx).
export default function RegistrarServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as unknown as { __draftersInstalar?: Event | null };
    const alAviso = (e: Event) => {
      e.preventDefault();
      w.__draftersInstalar = e;
      window.dispatchEvent(new Event('drafters-instalable'));
    };
    const alInstalar = () => {
      w.__draftersInstalar = null;
      void registrarUsoApp('instalada');
      window.dispatchEvent(new Event('drafters-instalada'));
    };
    // 13/10: estadística de aperturas desde el icono (y al iniciar sesión).
    void registrarAperturaSiToca();
    // 13/10: cada entrada con la sesión ya guardada cuenta en el Registro de actividad.
    void registrarEntradaConSesionGuardada();
    const { data: sub } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_IN') void registrarAperturaSiToca();
    });
    // Volver a la app/pestaña tras un rato (el móvil no recarga la página)
    // también cuenta como entrada, si han pasado 30 min desde la anterior.
    const alVolver = () => {
      if (document.visibilityState === 'visible') {
        void registrarEntradaConSesionGuardada();
        void registrarAperturaSiToca();
      }
    };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('beforeinstallprompt', alAviso);
    window.addEventListener('appinstalled', alInstalar);
    if (!('serviceWorker' in navigator)) return () => {
      sub.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('beforeinstallprompt', alAviso);
      window.removeEventListener('appinstalled', alInstalar);
    };
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Si falla, la web funciona igual; solo no se podrá instalar en Android.
    });
    // 18/10: llega una notificación push con Drafters abierto → sonido de Drafters.
    const alMensaje = (e: MessageEvent) => {
      if ((e.data as { tipo?: string } | null)?.tipo === 'drafters_sonido' && document.visibilityState === 'visible' && leerPreferenciaSonido()) reproducirSonidoAviso();
    };
    navigator.serviceWorker.addEventListener('message', alMensaje);
    return () => {
      navigator.serviceWorker.removeEventListener('message', alMensaje);
      sub.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('beforeinstallprompt', alAviso);
      window.removeEventListener('appinstalled', alInstalar);
    };
  }, []);
  return null;
}
