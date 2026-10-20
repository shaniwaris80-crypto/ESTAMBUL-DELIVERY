import { Redirect } from "expo-router";

// La app nativa inicia en el acceso conectado del Rider.
// La demostración ficticia queda disponible en /demo.
export default function Home(){
  return <Redirect href="/connected" />;
}
