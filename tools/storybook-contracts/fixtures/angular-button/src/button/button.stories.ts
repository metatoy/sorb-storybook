import type { Meta, StoryObj } from '@storybook/angular';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ButtonComponent } from './button.component';

const meta: Meta<ButtonComponent> = {
  title: 'Components/Button',
  component: ButtonComponent,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'ghost'] },
    size: { control: 'radio', options: ['sm', 'md', 'lg'] },
    disabled: { control: 'boolean' },
    loading: { control: 'boolean' },
    pressed: { action: 'pressed' },
  },
  args: { variant: 'primary', size: 'md', disabled: false, loading: false, label: 'Save', pressed: fn() },
  parameters: {
    contract: {
      version: '1.2.0',
      status: 'stable',
      ariaPattern: 'https://www.w3.org/WAI/ARIA/apg/patterns/button/',
      tokens: 'button',
    },
    design: { type: 'figma', url: 'https://www.figma.com/design/EXAMPLE/Button?node-id=1-2' },
    a11y: { test: 'error' },
  },
};
export default meta;
type Story = StoryObj<ButtonComponent>;

export const Primary: Story = {};
export const Secondary: Story = { args: { variant: 'secondary' } };
export const Ghost: Story = { args: { variant: 'ghost' } };
export const Small: Story = { args: { size: 'sm' } };
export const Large: Story = { args: { size: 'lg' } };
export const Disabled: Story = { args: { disabled: true } };
export const Loading: Story = { args: { loading: true } };
export const Hover: Story = { parameters: { pseudo: { hover: true } } };
export const Focus: Story = { parameters: { pseudo: { focusVisible: true } } };
export const KeyboardActivates: Story = {
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole('button');
    button.focus();
    await userEvent.keyboard('{Enter}');
    await expect(args.pressed).toHaveBeenCalled();
  },
};
