import type { StorybookConfig } from '@storybook/angular';

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-designs', 'storybook-addon-pseudo-states'],
  framework: { name: '@storybook/angular', options: {} },
};
export default config;
