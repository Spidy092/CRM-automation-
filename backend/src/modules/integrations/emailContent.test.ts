import { emailHtmlToText } from './emailContent';

describe('emailHtmlToText', () => {
  it('uses the href attribute rather than a data-href attribute', () => {
    expect(
      emailHtmlToText('<a href="https://files.example.com/p.pdf" data-href="https://old.example.com">Portfolio</a>'),
    ).toBe('Portfolio (https://files.example.com/p.pdf)');
  });
});
