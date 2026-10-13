import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-inicio-secretaria',
  imports: [RouterLink],
  template: `
    <h1>Agenda</h1>
    <p>Turnos de todos los kinesiólogos.</p>
    <nav aria-label="Secretaría">
      <ul>
        <li><a routerLink="/secretaria/pacientes">Pacientes</a></li>
        <li><a routerLink="/secretaria/consultorio">Datos del consultorio</a></li>
      </ul>
    </nav>
  `,
})
export class InicioSecretaria {}
