import { describe, it, expect } from "vitest";
import el from "@/messages/el.json";
import { nameInSentence, sentenceStart } from "./language-name";

/*
 * Greek writes a language's name in lower case inside a sentence ("στα
 * γερμανικά"); the catalogue's names are labels ("Γερμανικά"). Before,
 * the label went into the sentence as it was: "στα Γερμανικά".
 */
describe("a language's name in a sentence", () => {
  it("is lower case in Greek, as written in German and English", () => {
    expect(nameInSentence(el.courseManager.languageName.de, "el")).toBe("γερμανικά");
    expect(nameInSentence(el.courseManager.languageName.el, "el")).toBe("ελληνικά");
    expect(nameInSentence("Deutsch", "de")).toBe("Deutsch");
    expect(nameInSentence("German", "en")).toBe("German");
  });

  it("still starts a sentence with a capital", () => {
    expect(sentenceStart("γερμανικά για εκπαιδευόμενους", "el")).toBe("Γερμανικά για εκπαιδευόμενους");
    expect(sentenceStart("", "el")).toBe("");
  });
});
