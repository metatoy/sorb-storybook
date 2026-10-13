import React from 'react';

export interface TabsProps {
  orientation?: 'horizontal' | 'vertical';
  activation?: 'automatic' | 'manual';
  label: string;
  onChange?: (index: number) => void;
}

export const Tabs = ({ orientation = 'horizontal', activation = 'automatic', label, onChange }: TabsProps) => (
  <div role="tablist" aria-label={label} aria-orientation={orientation} data-activation={activation} />
);
