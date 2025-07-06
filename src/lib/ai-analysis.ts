import Anthropic from '@anthropic-ai/sdk'
import { prisma } from './prisma'
import { Playbook, Rule } from '@prisma/client'

interface ContractAnalysis {
  summary: string
  riskScore: number
  complianceScore: number
  changes: SuggestedChange[]
  missingClauses: string[]
  risks: RiskAssessment[]
  keyTerms: ExtractedTerm[]
}

interface SuggestedChange {
  type: 'REPLACEMENT' | 'INSERTION' | 'DELETION' | 'HIGHLIGHT'
  originalText?: string
  suggestedText?: string
  reason: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  ruleId?: string
  confidence: number
  position: TextPosition
}

interface RiskAssessment {
  type: string
  severity: string
  description: string
  impact: string
  mitigation: string
}

interface ExtractedTerm {
  term: string
  definition?: string
  category: string
  importance: string
}

interface TextPosition {
  start: number
  end: number
  line?: number
  column?: number
  paragraph?: number
}

export class AIAnalysisService {
  private anthropic: Anthropic

  constructor() {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is required')
    }
    
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    })
  }

  async analyzeContract(
    contractContent: string,
    playbook: Playbook & { rules: Rule[] }
  ): Promise<ContractAnalysis> {
    console.log(`🤖 Starting AI analysis for contract with playbook: ${playbook.name}`)

    try {
      const systemPrompt = this.buildSystemPrompt()
      const userPrompt = this.buildAnalysisPrompt(contractContent, playbook)

      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8000,
        temperature: 0.2,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })

      const firstContent = response.content[0]
      if (!firstContent || firstContent.type !== 'text') {
        throw new Error('Invalid response format from AI')
      }
      
      const analysisText = firstContent.text
      if (!analysisText) {
        throw new Error('Empty response from AI')
      }

      const analysis = this.parseAIResponse(analysisText)
      
      // Enhance changes with position data
      const enhancedChanges = await this.mapChangesToDocument(
        analysis.changes,
        contractContent
      )

      const result: ContractAnalysis = {
        ...analysis,
        changes: enhancedChanges
      }

      console.log(`✅ AI analysis completed. Found ${result.changes.length} suggestions`)
      return result

    } catch (error) {
      console.error('❌ AI analysis failed:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`AI analysis failed: ${errorMessage}`)
    }
  }

  private buildSystemPrompt(): string {
    return `You are an expert legal contract reviewer with extensive experience in commercial law, risk assessment, and compliance. Your role is to analyze contracts against provided playbook rules and suggest specific improvements.

**Core Responsibilities:**
1. Identify exact text that needs modification based on playbook rules
2. Provide specific replacement text with legal justification
3. Assess overall risk and compliance scores (0-10 scale)
4. Extract key terms and identify missing provisions
5. Maintain consistency with legal best practices

**Analysis Standards:**
- Be precise with text matching - quote exact phrases that need changes
- Provide clear, actionable recommendations
- Consider jurisdiction-specific requirements
- Assess both legal and business risks
- Follow GDPR and SOC2 compliance standards when applicable

**Output Format:**
Respond with valid JSON using this exact structure:
{
  "summary": "Brief executive summary of key findings",
  "riskScore": 7.5,
  "complianceScore": 8.2,
  "changes": [
    {
      "type": "REPLACEMENT",
      "originalText": "exact text to change",
      "suggestedText": "improved replacement text",
      "reason": "detailed explanation with legal basis",
      "severity": "HIGH",
      "ruleId": "rule-id-if-applicable",
      "confidence": 0.95
    }
  ],
  "missingClauses": ["list of important missing provisions"],
  "risks": [
    {
      "type": "Liability Risk",
      "severity": "HIGH",
      "description": "Specific risk description",
      "impact": "Potential business impact",
      "mitigation": "Recommended mitigation strategy"
    }
  ],
  "keyTerms": [
    {
      "term": "Key Term",
      "definition": "How it's defined in the contract",
      "category": "Legal/Business/Technical",
      "importance": "HIGH/MEDIUM/LOW"
    }
  ]
}

**Important:** Ensure all JSON is valid and properly escaped.`
  }

  private buildAnalysisPrompt(
    contractContent: string,
    playbook: Playbook & { rules: Rule[] }
  ): string {
    let prompt = `**CONTRACT TO ANALYZE:**\n\n${contractContent}\n\n`
    
    prompt += `**PLAYBOOK: ${playbook.name}**\n`
    if (playbook.description) {
      prompt += `Description: ${playbook.description}\n`
    }
    if (playbook.contractType) {
      prompt += `Contract Type: ${playbook.contractType}\n`
    }
    prompt += `\n**REVIEW RULES:**\n\n`

    // Sort rules by severity and order
    const sortedRules = playbook.rules
      .filter(rule => rule.isActive)
      .sort((a, b) => {
        const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 }
        const severityDiff = severityOrder[a.severity] - severityOrder[b.severity]
        return severityDiff !== 0 ? severityDiff : a.orderIndex - b.orderIndex
      })

    sortedRules.forEach((rule, index) => {
      prompt += `**Rule ${index + 1}: ${rule.name}** (ID: ${rule.id})\n`
      prompt += `Type: ${rule.type}\n`
      prompt += `Severity: ${rule.severity}\n`
      prompt += `Instructions: ${rule.aiPrompt}\n`
      
      if (rule.preferredLanguage) {
        prompt += `Preferred Language/Format:\n${rule.preferredLanguage}\n`
      }
      prompt += '\n'
    })

    prompt += `\n**ANALYSIS INSTRUCTIONS:**\n`
    prompt += `1. Review the contract against each active rule\n`
    prompt += `2. Identify specific text that violates or could improve compliance\n`
    prompt += `3. Provide exact replacement text following legal best practices\n`
    prompt += `4. Calculate risk score (0-10) considering: liability, enforceability, compliance gaps\n`
    prompt += `5. Calculate compliance score (0-10) for GDPR, SOC2, and industry standards\n`
    prompt += `6. Extract key terms and identify missing critical provisions\n\n`
    prompt += `Analyze thoroughly and provide specific, actionable recommendations.`

    return prompt
  }

  private parseAIResponse(responseText: string): Omit<ContractAnalysis, 'changes'> & { changes: Omit<SuggestedChange, 'position'>[] } {
    try {
      // Extract JSON from response (in case there's additional text)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in AI response')
      }

      const analysis = JSON.parse(jsonMatch[0])
      
      // Validate required fields
      if (!analysis.summary || typeof analysis.riskScore !== 'number') {
        throw new Error('Invalid analysis structure')
      }

      // Ensure arrays exist
      analysis.changes = analysis.changes || []
      analysis.missingClauses = analysis.missingClauses || []
      analysis.risks = analysis.risks || []
      analysis.keyTerms = analysis.keyTerms || []

      // Validate and normalize scores
      analysis.riskScore = Math.max(0, Math.min(10, analysis.riskScore))
      analysis.complianceScore = Math.max(0, Math.min(10, analysis.complianceScore || 5))

      return analysis
    } catch (error) {
      console.error('Failed to parse AI response:', error)
      console.error('Raw response:', responseText)
      const errorMessage = error instanceof Error ? error.message : 'Unknown parsing error'
      throw new Error(`Failed to parse AI response: ${errorMessage}`)
    }
  }

  private async mapChangesToDocument(
    changes: Omit<SuggestedChange, 'position'>[],
    contractContent: string
  ): Promise<SuggestedChange[]> {
    return changes.map(change => {
      const position = this.findTextPosition(
        change.originalText || '',
        contractContent
      )

      return {
        ...change,
        position
      }
    })
  }

  private findTextPosition(searchText: string, fullText: string): TextPosition {
    if (!searchText) {
      return { start: 0, end: 0 }
    }

    // Try exact match first
    let index = fullText.indexOf(searchText)
    
    if (index === -1) {
      // Try fuzzy matching for slight variations
      index = this.fuzzyFindPosition(searchText, fullText)
    }

    if (index === -1) {
      console.warn(`Could not find position for text: ${searchText.substring(0, 50)}...`)
      return { start: 0, end: 0 }
    }

    const start = index
    const end = index + searchText.length
    
    // Calculate line and column for better positioning
    const beforeText = fullText.substring(0, start)
    const lines = beforeText.split('\n')
    const line = lines.length
    const column = lines[lines.length - 1].length + 1

    return {
      start,
      end,
      line,
      column
    }
  }

  private fuzzyFindPosition(searchText: string, fullText: string): number {
    // Implement fuzzy matching algorithm
    const normalizeText = (text: string) => 
      text.toLowerCase().replace(/\s+/g, ' ').trim()

    const normalizedSearch = normalizeText(searchText)
    const normalizedFull = normalizeText(fullText)

    const index = normalizedFull.indexOf(normalizedSearch)
    
    if (index !== -1) {
      // Map back to original text position
      let originalIndex = 0
      let normalizedIndex = 0
      
      while (normalizedIndex < index && originalIndex < fullText.length) {
        const char = fullText[originalIndex]
        const normalizedChar = normalizeText(char)
        
        if (normalizedChar) {
          normalizedIndex += normalizedChar.length
        }
        originalIndex++
      }
      
      return originalIndex
    }

    return -1
  }

  // Batch analysis for multiple contracts
  async analyzeMultipleContracts(
    contracts: { id: string; content: string }[],
    playbookId: string
  ): Promise<{ contractId: string; analysis: ContractAnalysis | null; error?: string }[]> {
    const playbook = await prisma.playbook.findUnique({
      where: { id: playbookId },
      include: { rules: true }
    })

    if (!playbook) {
      throw new Error('Playbook not found')
    }

    const results = []
    
    for (const contract of contracts) {
      try {
        const analysis = await this.analyzeContract(contract.content, playbook)
        results.push({
          contractId: contract.id,
          analysis
        })
      } catch (error) {
        console.error(`Failed to analyze contract ${contract.id}:`, error)
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        results.push({
          contractId: contract.id,
          analysis: null,
          error: errorMessage
        })
      }
    }

    return results
  }
}
