/**
 * Reloj inyectable. Toda lógica que depende de la hora lo recibe por parámetro en lugar de llamar a
 * `new Date()` o `Date.now()`, para que las pruebas controlen el tiempo (plan.md §6.2). La zona
 * horaria del consultorio viaja junto con el reloj (RF-12).
 */
export interface Reloj {
  readonly zonaHoraria: string;
  ahora(): Date;
}

export function relojDelSistema(zonaHoraria: string): Reloj {
  return {
    zonaHoraria,
    ahora: () => new Date(),
  };
}

/** Reloj detenido en un instante, que solo avanza cuando la prueba lo pide. */
export class RelojFijo implements Reloj {
  private instante: number;

  constructor(
    inicio: Date | string,
    readonly zonaHoraria = 'America/Argentina/Buenos_Aires',
  ) {
    this.instante = new Date(inicio).getTime();
  }

  ahora(): Date {
    return new Date(this.instante);
  }

  avanzar(milisegundos: number): void {
    this.instante += milisegundos;
  }

  fijar(instante: Date | string): void {
    this.instante = new Date(instante).getTime();
  }
}
