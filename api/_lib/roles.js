// Who the storyteller and the asker are to each other, e.g. "a son asks his mother".
// Stored on the storyteller as life_card.about = { gender, askerGender } ("female" | "male").
export const GENDERS = ["female", "male"];

const ROLE = {
  parent: { teller: { female: "mother", male: "father" }, asker: { female: "daughter", male: "son" } },
  child: { teller: { female: "daughter", male: "son" }, asker: { female: "mother", male: "father" } },
  partner: { teller: { female: "girlfriend or wife", male: "boyfriend or husband" }, asker: { female: "girlfriend or wife", male: "boyfriend or husband" } },
  friend: { teller: { female: "female friend", male: "male friend" }, asker: { female: "female friend", male: "male friend" } }
};
const WHO = { female: "a woman", male: "a man" };

export function aboutOf(teller) {
  const about = (teller && teller.life_card && teller.life_card.about) || {};
  return {
    gender: GENDERS.includes(about.gender) ? about.gender : null,
    askerGender: GENDERS.includes(about.askerGender) ? about.askerGender : null
  };
}

// English lines for prompts. Unknown genders stay unsaid rather than guessed.
export function describeRoles({ name, from, relationship, about }) {
  const r = ROLE[relationship];
  const g = about || {};
  const tellerRole = r && g.gender ? r.teller[g.gender] : relationship || "loved one";
  const askerRole = r && g.askerGender ? r.asker[g.askerGender] : "family member";
  const lines = [
    `The storyteller is ${name || "the storyteller"}${g.gender ? `, ${WHO[g.gender]}` : ""}, the asker's ${tellerRole}.`,
    `The person who asked is ${from || "a family member"}${g.askerGender ? `, ${WHO[g.askerGender]}` : ""}, the storyteller's ${askerRole}.`
  ];
  if (!g.gender) lines.push("The storyteller's gender was not given: take it from the story and grammar if clear; otherwise keep it neutral.");
  return { tellerRole, askerRole, text: lines.join(" ") };
}
