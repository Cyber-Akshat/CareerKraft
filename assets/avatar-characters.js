((root, factory) => {
  const characters = factory();
  if (typeof module === "object" && module.exports) module.exports = characters;
  else root.careerAvatarCharacters = characters;
})(typeof window !== "undefined" ? window : globalThis, () => Object.freeze([
  { id: "nova", name: "Nova", description: "A curious little robot.", imageUrl: "/assets/avatars/nova.png" },
  { id: "pip", name: "Pip", description: "A fox with big ideas.", imageUrl: "/assets/avatars/pip.png" },
  { id: "mochi", name: "Mochi", description: "A cat with cosy energy.", imageUrl: "/assets/avatars/mochi.png" },
  { id: "bloop", name: "Bloop", description: "An alien ready to explore.", imageUrl: "/assets/avatars/bloop.png" },
  { id: "sprout", name: "Sprout", description: "A little bud, growing every day.", imageUrl: "/assets/avatars/sprout.png" },
  { id: "luna", name: "Luna", description: "An owl full of bright ideas.", imageUrl: "/assets/avatars/luna.png" }
].map(character => Object.freeze(character))));
