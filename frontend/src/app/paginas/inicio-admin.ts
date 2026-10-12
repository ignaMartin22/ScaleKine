import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-inicio-admin',
  imports: [RouterLink],
  template: `
    <h1>Administración</h1>
    <p>Gestión de cuentas y kinesiólogos.</p>
    <nav aria-label="Administración">
      <ul>
        <li><a routerLink="/admin/cuentas">Cuentas</a></li>
      </ul>
    </nav>
  `,
})
export class InicioAdmin {}
