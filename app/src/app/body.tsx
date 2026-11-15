/* /body ya no es una pestaña: Cuerpo vive dentro de Salud */
import { Redirect } from 'expo-router';
export default function IrACuerpo() { return <Redirect href={{ pathname: '/salud', params: { seg: 'cuerpo' } }} />; }
