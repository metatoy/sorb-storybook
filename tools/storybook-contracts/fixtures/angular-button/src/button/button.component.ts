import { Component, EventEmitter, Input, Output, input } from '@angular/core';

@Component({
  selector: 'ds-button',
  standalone: true,
  template: `<button [attr.aria-busy]="loading()" [disabled]="disabled" (click)="pressed.emit()">{{ label }}</button>`,
})
export class ButtonComponent {
  @Input() variant: 'primary' | 'secondary' | 'ghost' = 'primary';
  @Input() disabled = false;
  @Input({ required: true }) label!: string;
  size = input<'sm' | 'md' | 'lg'>('md');
  loading = input<boolean>(false);
  @Output() pressed = new EventEmitter<void>();
  private internal = 1;
}
