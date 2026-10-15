import {
  Component,
  ElementRef,
  type OnDestroy,
  afterNextRender,
  inject,
  input,
  output,
} from '@angular/core';

const FOCALIZABLES =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo modal accesible: `role="dialog"` con título asociado, el foco entra al abrirse, queda
 * atrapado con Tab, Escape lo cierra y el foco vuelve a quien lo abrió. El contenido se proyecta.
 */
@Component({
  selector: 'app-dialogo',
  template: `
    <div class="dialogo-fondo">
      <div
        class="dialogo"
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="idTitulo()"
        (keydown)="teclado($event)"
      >
        <h2 [id]="idTitulo()" tabindex="-1">{{ titulo() }}</h2>
        <ng-content />
      </div>
    </div>
  `,
})
export class Dialogo implements OnDestroy {
  readonly titulo = input.required<string>();
  readonly idTitulo = input('titulo-dialogo');
  readonly cerrar = output();

  private readonly elemento = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly abridor = document.activeElement as HTMLElement | null;

  constructor() {
    afterNextRender(() => {
      const dialogo = this.elemento.nativeElement.querySelector<HTMLElement>('[role="dialog"]');
      const primero = dialogo?.querySelector<HTMLElement>('[data-foco-inicial]');
      (primero ?? dialogo?.querySelector<HTMLElement>('h2'))?.focus();
    });
  }

  ngOnDestroy(): void {
    if (this.abridor?.isConnected) this.abridor.focus();
  }

  protected teclado(evento: KeyboardEvent): void {
    if (evento.key === 'Escape') {
      evento.preventDefault();
      evento.stopPropagation();
      this.cerrar.emit();
      return;
    }
    if (evento.key !== 'Tab') return;
    const dialogo = evento.currentTarget as HTMLElement;
    const lista = Array.from(dialogo.querySelectorAll<HTMLElement>(FOCALIZABLES));
    if (lista.length === 0) {
      evento.preventDefault();
      return;
    }
    const primero = lista[0];
    const ultimo = lista[lista.length - 1];
    const activo = document.activeElement;
    if (evento.shiftKey && (activo === primero || activo === dialogo.querySelector('h2'))) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && activo === ultimo) {
      evento.preventDefault();
      primero.focus();
    }
  }
}
