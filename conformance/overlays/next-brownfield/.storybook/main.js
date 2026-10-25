// Storybook's configuration, as an app that uses it has one: the stories beside the components.
// The fixture keeps the stories and leaves Storybook's own packages out: roughbook map reads the
// stories as fixtures, and nothing in the conformance run starts Storybook.
const config = {
  stories: ["../components/**/*.stories.@(ts|tsx)"],
  framework: { name: "@storybook/nextjs", options: {} },
};

export default config;
