import type { Meta, StoryObj } from '@storybook/react';
import { Tabs } from './Tabs';

// Deliberately non-conforming: argTypes disagree with the component, coverage gaps, no a11y pattern.
export default {
  title: 'Navigation/Tabs',
  component: Tabs,
  argTypes: {
    orientation: { control: 'radio', options: ['horizontal', 'vertical', 'diagonal'] },
    size: { control: 'select', options: ['s', 'l'] },
  },
  args: { label: 'Sections' },
  parameters: { contract: { status: 'draft' } },
} satisfies Meta<typeof Tabs>;

export const Horizontal: StoryObj<typeof Tabs> = {};
