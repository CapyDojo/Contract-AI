import mammoth from 'mammoth'
import { createHash } from 'crypto'

interface LexicalState {
  root: {
    children: LexicalNode[]
    direction: string
    format: string
    indent: number
    type: string
    version: number
  }
}

interface LexicalNode {
  children?: LexicalNode[]
  direction?: string
  format?: string | number
  indent?: number
  type: string
  version?: number
  text?: string
  detail?: number
  mode?: string
  style?: string
}

interface ProcessedDocument {
  content: string
  metadata: DocumentMetadata
  lexicalState?: LexicalState
}

interface DocumentMetadata {
  originalName: string
  mimeType: string
  fileSize: number
  checksum: string
  wordCount: number
  pageCount?: number
  extractedAt: Date
  processingErrors?: string[]
}

export class DocumentProcessor {
  
  async processWordDocument(buffer: Buffer, originalName: string): Promise<ProcessedDocument> {
    console.log(`📄 Processing Word document: ${originalName}`)
    
    try {
      // Generate checksum for integrity
      const checksum = createHash('sha256').update(buffer).digest('hex')
      
      // Extract content using mammoth
      const result = await mammoth.extractRawText({ buffer })
      const htmlResult = await mammoth.convertToHtml({ buffer })
      
      const content = result.value
      const htmlContent = htmlResult.value
      
      // Calculate basic metrics
      const wordCount = this.countWords(content)
      const pageCount = this.estimatePageCount(content)
      
      // Extract metadata
      const metadata: DocumentMetadata = {
        originalName,
        mimeType: this.getMimeTypeFromName(originalName),
        fileSize: buffer.length,
        checksum,
        wordCount,
        pageCount,
        extractedAt: new Date(),
        processingErrors: [...result.messages, ...htmlResult.messages]
          .filter(msg => msg.type === 'error')
          .map(msg => msg.message)
      }

      // Convert HTML to Lexical format
      const lexicalState = this.htmlToLexical(htmlContent)

      console.log(`✅ Document processed: ${wordCount} words, ${metadata.processingErrors?.length || 0} errors`)

      return {
        content,
        metadata,
        lexicalState
      }
      
    } catch (error) {
      console.error(`❌ Failed to process document ${originalName}:`, error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Document processing failed: ${errorMessage}`)
    }
  }

  async processPlainText(text: string, filename: string): Promise<ProcessedDocument> {
    const buffer = Buffer.from(text, 'utf-8')
    const checksum = createHash('sha256').update(buffer).digest('hex')
    
    const metadata: DocumentMetadata = {
      originalName: filename,
      mimeType: 'text/plain',
      fileSize: buffer.length,
      checksum,
      wordCount: this.countWords(text),
      extractedAt: new Date(),
      processingErrors: []
    }

    const lexicalState = this.textToLexical(text)

    return {
      content: text,
      metadata,
      lexicalState
    }
  }

  private countWords(text: string): number {
    return text
      .trim()
      .split(/\s+/)
      .filter(word => word.length > 0)
      .length
  }

  private estimatePageCount(text: string): number {
    // Rough estimate: 250 words per page
    const wordsPerPage = 250
    return Math.ceil(this.countWords(text) / wordsPerPage)
  }

  private getMimeTypeFromName(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop()
    
    const mimeTypes: Record<string, string> = {
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'doc': 'application/msword',
      'pdf': 'application/pdf',
      'txt': 'text/plain',
      'rtf': 'application/rtf'
    }
    
    return mimeTypes[ext || ''] || 'application/octet-stream'
  }

  private htmlToLexical(html: string): LexicalState {
    // Convert HTML to Lexical editor state
    // This is a simplified conversion - in a real implementation,
    // you'd use Lexical's HTML import functionality
    
    // Remove HTML tags for basic text extraction
    const textContent = html.replace(/<[^>]*>/g, '')
    
    // Create basic Lexical structure
    const lexicalState = {
      root: {
        children: [
          {
            children: [
              {
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                text: textContent,
                type: "text",
                version: 1
              }
            ],
            direction: "ltr",
            format: "",
            indent: 0,
            type: "paragraph",
            version: 1
          }
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "root",
        version: 1
      }
    }

    return lexicalState
  }

  private textToLexical(text: string): LexicalState {
    // Convert plain text to Lexical format
    const paragraphs = text.split('\n\n').filter(p => p.trim())
    
    const children = paragraphs.map(paragraph => ({
      children: [
        {
          detail: 0,
          format: 0,
          mode: "normal",
          style: "",
          text: paragraph.trim(),
          type: "text",
          version: 1
        }
      ],
      direction: "ltr",
      format: "",
      indent: 0,
      type: "paragraph",
      version: 1
    }))

    return {
      root: {
        children,
        direction: "ltr",
        format: "",
        indent: 0,
        type: "root",
        version: 1
      }
    }
  }

  // Export functionality - convert Lexical state back to Word format
  async exportToWord(lexicalState: LexicalState): Promise<Buffer> {
    // This would require a more sophisticated implementation
    // For now, we'll export as simple text
    
    const textContent = this.lexicalToText(lexicalState)
    
    // In a full implementation, you'd use a library like docx to create
    // a proper Word document with formatting preserved
    return Buffer.from(textContent, 'utf-8')
  }

  private lexicalToText(lexicalState: LexicalState): string {
    if (!lexicalState?.root?.children) {
      return ''
    }

    const extractText = (node: LexicalNode): string => {
      if (node.type === 'text') {
        return node.text || ''
      }
      
      if (node.children) {
        return node.children.map(extractText).join('')
      }
      
      return ''
    }

    return lexicalState.root.children
      .map(extractText)
      .join('\n\n')
  }

  // Validate uploaded files
  validateFile(file: File): { valid: boolean; error?: string } {
    const maxSize = parseInt(process.env.MAX_FILE_SIZE || '94371840') // 90MB
    const allowedTypes = process.env.ALLOWED_FILE_TYPES?.split(',') || [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/pdf',
      'text/plain'
    ]

    if (file.size > maxSize) {
      return {
        valid: false,
        error: `File size ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds maximum allowed size of ${(maxSize / 1024 / 1024).toFixed(1)}MB`
      }
    }

    if (!allowedTypes.includes(file.type)) {
      return {
        valid: false,
        error: `File type ${file.type} is not supported. Allowed types: ${allowedTypes.join(', ')}`
      }
    }

    return { valid: true }
  }

  // Extract key information from contract
  async extractContractMetadata(content: string): Promise<{
    parties: string[]
    effectiveDate?: string
    expirationDate?: string
    contractType?: string
    keyTerms: string[]
  }> {
    // Basic regex-based extraction
    // In a full implementation, you might use NLP or AI for this
    
    const parties = this.extractParties(content)
    const effectiveDate = this.extractDate(content, /effective.*?date.*?:?\s*([^\\n]+)/i)
    const expirationDate = this.extractDate(content, /expir.*?date.*?:?\s*([^\\n]+)/i)
    const contractType = this.extractContractType(content)
    const keyTerms = this.extractKeyTerms(content)

    return {
      parties,
      effectiveDate,
      expirationDate,
      contractType,
      keyTerms
    }
  }

  private extractParties(content: string): string[] {
    const parties: string[] = []
    
    // Look for common party indicators
    const partyPatterns = [
      /between\s+([^,]+?)\s+(?:and|&)/i,
      /party.*?:\s*([^\\n]+)/i,
      /client.*?:\s*([^\\n]+)/i,
      /vendor.*?:\s*([^\\n]+)/i
    ]

    partyPatterns.forEach(pattern => {
      const match = content.match(pattern)
      if (match && match[1]) {
        parties.push(match[1].trim())
      }
    })

    return [...new Set(parties)] // Remove duplicates
  }

  private extractDate(content: string, pattern: RegExp): string | undefined {
    const match = content.match(pattern)
    if (match && match[1]) {
      // Try to parse and format the date
      const dateStr = match[1].trim()
      const date = new Date(dateStr)
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0] // YYYY-MM-DD format
      }
      return dateStr
    }
    return undefined
  }

  private extractContractType(content: string): string | undefined {
    const typePatterns = [
      /(?:this\s+)?(\w+\s+agreement)/i,
      /(?:this\s+)?(\w+\s+contract)/i,
      /(non-disclosure\s+agreement)/i,
      /(service\s+agreement)/i,
      /(employment\s+agreement)/i,
      /(license\s+agreement)/i
    ]

    for (const pattern of typePatterns) {
      const match = content.match(pattern)
      if (match && match[1]) {
        return match[1].toLowerCase()
      }
    }

    return undefined
  }

  private extractKeyTerms(content: string): string[] {
    // Extract potential key terms (this is very basic)
    const terms: string[] = []
    
    // Look for defined terms
    const definedTermsPattern = /"([^"]+)"\s+(?:means|shall mean)/g
    let match
    while ((match = definedTermsPattern.exec(content)) !== null) {
      terms.push(match[1])
    }

    // Look for capitalized terms that appear multiple times
    const capitalizedTerms = content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || []
    const termCounts: Record<string, number> = {}
    
    capitalizedTerms.forEach(term => {
      if (term.length > 3) { // Ignore short terms
        termCounts[term] = (termCounts[term] || 0) + 1
      }
    })

    // Add terms that appear multiple times
    Object.entries(termCounts)
      .filter(([, count]) => count >= 3)
      .map(([term]) => term)
      .forEach(term => terms.push(term))

    return [...new Set(terms)].slice(0, 20) // Limit to 20 terms
  }
}
