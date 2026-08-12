const FAKE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class MockGeminiProvider {
  async startConversation(bookText) {
    await delay(300);
    return `mock-conversation-${Date.now()}`;
  }

  async generateStyle(conversationRef, userSuppliedStyle) {
    await delay(400);
    if (userSuppliedStyle) {
      return { style: `${userSuppliedStyle} (as you specified).` };
    }
    return {
      style:
        'Warm, hand-painted watercolour with soft ink outlines — a storybook feel.',
    };
  }

  async generateCharacters(conversationRef) {
    await delay(400);
    return {
      characters: [
        { name: 'Character A', prompt: 'A protagonist drawn from the book text.' },
        { name: 'Character B', prompt: 'A companion who appears throughout.' },
      ],
    };
  }

  // Singular, per-item methods — called once per character/chapter so the
  // caller (stepRunner) can persist progress after each one lands, instead
  // of waiting for a single bulk response.
  async generatePortrait(conversationRef, character) {
    await delay(350);
    return { mimeType: 'image/png', data: FAKE_PNG_BASE64 };
  }

  async generateIllustration(conversationRef, chapter) {
    await delay(350);
    return { mimeType: 'image/png', data: FAKE_PNG_BASE64 };
  }

  async generateChapters(conversationRef) {
    await delay(400);
    return {
      chapters: [
        {
          name: 'Opening Scene',
          prompt: 'An illustration of the opening scene, featuring both characters.',
        },
      ],
    };
  }

}

module.exports = { MockGeminiProvider };
