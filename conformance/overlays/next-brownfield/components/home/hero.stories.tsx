import Hero from "./hero";

// Storybook's story for the hero (Component Story Format), as the app's own fixture.
const meta = {
  title: "Home/Hero",
  component: Hero,
  args: { cta: { label: "Start free", href: "/pricing" } },
};

export default meta;

export const Default = {
  args: { title: "Plan less, ship more" },
};

export const Long = {
  args: { title: "A much longer headline, to see how the hero wraps on a phone" },
};
