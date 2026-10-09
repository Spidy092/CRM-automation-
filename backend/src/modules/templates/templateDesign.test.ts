import {
  TEMPLATE_DESIGN_VERSION,
  checkEmailCompliance,
  emailHtmlToText,
  estimateSmsSegments,
  extractVariableNames,
  findInvalidVariables,
  findUnsafeLinks,
  isSafeLink,
  previewValues,
  renderDesignToHtml,
  sanitizeCustomHtml,
  sanitizeInlineStyle,
  substituteVariables,
  validateDesign,
  validateWhatsappBody,
  type TemplateDesign,
} from './templateDesign';

function validDesign(): TemplateDesign {
  return {
    version: TEMPLATE_DESIGN_VERSION,
    global: {
      backgroundColor: '#f1f5f9',
      contentWidth: 600,
      brandColor: '#4338ca',
      fontFamily: 'Arial, Helvetica, sans-serif',
      preheader: 'Preview text',
    },
    blocks: [
      { id: 'h1', type: 'header', props: { logoSrc: '', logoAlt: 'Co', title: 'Hello {{first_name}}', backgroundColor: '#ffffff', textColor: '#0f172a' } },
      { id: 't1', type: 'text', props: { text: 'Hi {{first_name}}, welcome to {{business_name}}.', fontSize: 16, color: '#1e293b', align: 'left', bold: false, italic: false } },
      { id: 'b1', type: 'button', props: { label: 'View portfolio', href: 'https://example.com/work', backgroundColor: '#4338ca', textColor: '#ffffff', shape: 'rounded', align: 'center' } },
      { id: 'f1', type: 'footer', props: { text: 'Acme Co, 1 Main St', backgroundColor: '#f8fafc', textColor: '#64748b', unsubscribeHref: '{{unsubscribe_link}}' } },
    ],
  };
}

describe('validateDesign', () => {
  it('accepts a valid design document', () => {
    const result = validateDesign(validDesign());
    expect(result.ok).toBe(true);
  });

  it('rejects designs without a footer block (compliance guard)', () => {
    const design = validDesign();
    design.blocks = design.blocks.filter((b) => b.type !== 'footer');
    const result = validateDesign(design);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/footer/i);
  });

  it('rejects duplicate block ids', () => {
    const design = validDesign();
    design.blocks = [...design.blocks, { ...design.blocks[0] }];
    const result = validateDesign(design);
    expect(result.ok).toBe(false);
  });

  it('rejects wrong version and empty block lists', () => {
    expect(validateDesign({ ...validDesign(), version: 99 }).ok).toBe(false);
    expect(validateDesign({ ...validDesign(), blocks: [] }).ok).toBe(false);
    expect(validateDesign(null).ok).toBe(false);
    expect(validateDesign('not-an-object').ok).toBe(false);
  });

  it('rejects oversized designs', () => {
    const blocks = Array.from({ length: 61 }, (_, i) => ({
      id: `t${i}`,
      type: 'text' as const,
      props: { text: 'x', fontSize: 16, color: '#1e293b', align: 'left' as const, bold: false, italic: false },
    }));
    const result = validateDesign({ ...validDesign(), blocks });
    expect(result.ok).toBe(false);
  });
});

describe('renderDesignToHtml', () => {
  it('renders deterministic email-safe HTML with all blocks', () => {
    const first = renderDesignToHtml(validDesign());
    const second = renderDesignToHtml(validDesign());
    expect(first.html).toBe(second.html);
    expect(first.html).toContain('<table');
    expect(first.html).toContain('View portfolio');
    expect(first.html).toContain('{{first_name}}');
    expect(first.html).toContain('Unsubscribe');
    expect(first.html).toContain('max-width:600px');
    // No external stylesheets or scripts in output.
    expect(first.html).not.toMatch(/<script/i);
    expect(first.html).not.toMatch(/<link/i);
  });

  it('renders two-column sections as table cells', () => {
    const design = validDesign();
    design.blocks = [
      { id: 'c1', type: 'columns', props: { columns: '2', left: { text: 'Left {{industry}}', imageSrc: '', imageAlt: '', buttonLabel: '', buttonHref: '' }, right: { text: 'Right', imageSrc: '', imageAlt: '', buttonLabel: '', buttonHref: '' }, gap: 16 } },
      { id: 'f1', type: 'footer', props: { text: 'Bye', backgroundColor: '#f8fafc', textColor: '#64748b', unsubscribeHref: 'https://example.com/unsub' } },
    ];
    const { html, text } = renderDesignToHtml(design);
    expect(html).toContain('Left {{industry}}');
    expect(text).toContain('Left {{industry}}');
  });

  it('generates a plain-text alternative preserving link destinations', () => {
    const { text } = renderDesignToHtml(validDesign());
    expect(text).toContain('View portfolio (https://example.com/work)');
  });

  it('save/reopen round trip preserves the structured document', () => {
    const design = validDesign();
    const reparsed = validateDesign(JSON.parse(JSON.stringify(design)));
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) {
      expect(renderDesignToHtml(reparsed.design).html).toBe(renderDesignToHtml(design).html);
    }
  });
});

describe('sanitizeCustomHtml', () => {
  it('strips scripts, event handlers, and unsafe protocols', () => {
    const { html, stripped } = sanitizeCustomHtml(
      '<p onclick="steal()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><a href="https://example.com">ok</a>',
    );
    expect(stripped).toBe(true);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('https://example.com');
  });

  it('blocks data: image sources and iframes', () => {
    const { html } = sanitizeCustomHtml(
      '<img src="data:image/png;base64,AAA" /><iframe src="https://evil.example"></iframe><img src="https://example.com/a.png" alt="a" />',
    );
    expect(html).not.toContain('data:');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('https://example.com/a.png');
  });

  it('preserves the CRM portfolio button marker', () => {
    const { html } = sanitizeCustomHtml(
      '<a data-crm-portfolio="true" href="https://example.com/p.pdf" style="display:inline-block;">View portfolio</a>',
    );
    expect(html).toContain('data-crm-portfolio="true"');
    expect(html).toContain('https://example.com/p.pdf');
  });

  it('sanitizes inline styles to the safe property allowlist', () => {
    expect(sanitizeInlineStyle('color:red;position:absolute;behavior:url(x);font-size:16px')).toBe(
      'color:red; font-size:16px',
    );
  });
});

describe('personalization', () => {
  it('extracts and flags unknown variables', () => {
    expect(extractVariableNames('Hi {{first_name}} from {{business_name}}')).toEqual([
      'first_name',
      'business_name',
    ]);
    expect(findInvalidVariables('Hi {{first_name}} {{made_up}}')).toEqual(['made_up']);
    expect(findInvalidVariables('Hi {{first_name}}')).toEqual([]);
  });

  it('escapes values in HTML context but not in plain text', () => {
    const values = { ...previewValues(), first_name: '<b>Jordan</b>' };
    expect(substituteVariables('Hi {{first_name}}', values, true)).toBe('Hi &lt;b&gt;Jordan&lt;/b&gt;');
    expect(substituteVariables('Hi {{first_name}}', values, false)).toBe('Hi <b>Jordan</b>');
    expect(substituteVariables('Hi {{unknown_var}}!', values, false)).toBe('Hi !');
  });

  it('preview values are fictional samples, not real PII', () => {
    const values = previewValues();
    expect(values.first_name).toBeTruthy();
    expect(values.unsubscribe_link).toContain('example.com');
  });
});

describe('link safety', () => {
  it('allows http/https/mailto/tel and relative links only', () => {
    expect(isSafeLink('https://example.com/a')).toBe(true);
    expect(isSafeLink('mailto:hi@example.com')).toBe(true);
    expect(isSafeLink('/p/slug')).toBe(true);
    expect(isSafeLink('javascript:alert(1)')).toBe(false);
    expect(isSafeLink('data:text/html,hi')).toBe(false);
    expect(findUnsafeLinks('<a href="javascript:x">a</a><a href="https://ok.example">b</a>')).toEqual([
      'javascript:x',
    ]);
  });
});

describe('emailHtmlToText', () => {
  it('keeps link destinations for plain-text readers', () => {
    expect(emailHtmlToText('<p>See <a href="https://example.com">our work</a></p>')).toBe(
      'See our work (https://example.com)',
    );
  });
});

describe('estimateSmsSegments', () => {
  it('counts single GSM-7 messages', () => {
    const est = estimateSmsSegments('Hello {{first_name}}');
    expect(est.encoding).toBe('GSM-7');
    expect(est.segments).toBe(1);
  });

  it('estimates concatenated GSM-7 segments', () => {
    const est = estimateSmsSegments('a'.repeat(200));
    expect(est.encoding).toBe('GSM-7');
    expect(est.segments).toBe(2);
  });

  it('switches to UCS-2 for non-GSM characters', () => {
    const est = estimateSmsSegments('Hello 👋');
    expect(est.encoding).toBe('UCS-2');
    expect(est.segments).toBe(1);
    const long = estimateSmsSegments(`👋`.repeat(80));
    expect(long.segments).toBe(2);
  });
});

describe('validateWhatsappBody', () => {
  it('requires non-empty text within the Cloud API limit', () => {
    expect(validateWhatsappBody('', 0).ok).toBe(false);
    expect(validateWhatsappBody('Hi {{first_name}}', 0).ok).toBe(true);
    expect(validateWhatsappBody('x'.repeat(4097), 0).ok).toBe(false);
  });

  it('warns when multiple attachments exceed single-media capability', () => {
    const result = validateWhatsappBody('Hi', 2);
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/first attachment/i);
  });
});

describe('checkEmailCompliance', () => {
  it('warns (never blocks) when unsubscribe content is missing', () => {
    const missing = checkEmailCompliance('<p>Hello</p>');
    expect(missing.errors).toEqual([]);
    expect(missing.warnings.join(' ')).toMatch(/unsubscribe/i);
    const present = checkEmailCompliance('<p>Hello</p><a href="https://x.example">Unsubscribe</a>');
    expect(present.warnings).toEqual([]);
  });
});
