# Cambios 05/10 — Login con usuario o email y fecha de nacimiento en Android

## Login con nombre de usuario o email
- Problema: el campo "Usuario o email" era `type="email"`, así que el navegador rechazaba cualquier usuario sin "@", y además el código solo llamaba a `signInWithPassword({ email })`.
- Ahora el campo es de texto. Si lleva "@" se inicia sesión directo con Supabase como antes. Si no, el login llama a `POST /api/login` (`app/api/login/route.ts`): el servidor busca el email del usuario en `perfiles` (sin distinguir mayúsculas), inicia sesión con la contraseña y devuelve solo los tokens; el navegador los instala con `supabase.auth.setSession`.
- El email nunca se devuelve al navegador (así no se pueden sacar los emails de los jugadores a partir del nombre de usuario). Un usuario inexistente da el mismo error que una contraseña mala.
- Mensaje de error cambiado a "Usuario o email, o contraseña, incorrectos." (`lib/authErrors.ts`).
- Limitación: si alguien con el email sin verificar entra con su usuario, no hay enlace directo a /verificar (no se conoce el email en el navegador); el mensaje le dice que revise su correo.
- No requiere SQL. Requiere `SUPABASE_SERVICE_ROLE_KEY` en Vercel (ya existe, la usan las rutas admin).

## Fecha de nacimiento (registro desde Android)
- `<input type="date">` sustituido por tres desplegables Día / Mes / Año (`components/FechaNacimientoSelect.tsx`), usado en `/registro` y `/cuenta`. Los desplegables funcionan igual en cualquier navegador; el calendario nativo falla o es incómodo en algunos Android y en los navegadores integrados de apps (Instagram, WhatsApp...).
- Años disponibles: de hoy−14 a hoy−100. El día se ajusta al mes (febrero, bisiestos).
- Nuevo: el registro valida que la fecha esté completa y que el usuario tenga al menos 18 años (el texto ya lo decía, pero no se comprobaba).
