/* El diario vive en la pestaña Journal; esta ruta queda para los enlaces (por ejemplo, el widget nova://diario). */
import { Redirect } from 'expo-router';

export default function Diario() {
  return <Redirect href="/journal" />;
}
