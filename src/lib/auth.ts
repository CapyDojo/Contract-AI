import { NextAuthOptions } from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'
import { prisma } from './prisma'
import bcrypt from 'bcryptjs'

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const user = await prisma.user.findUnique({
          where: {
            email: credentials.email
          }
        })

        if (!user || !user.hashedPassword) {
          return null
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.hashedPassword
        )

        if (!isPasswordValid) {
          return null
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        }
      }
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    })
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        token.sub = user.id
      }
      if (account) {
        token.accessToken = account.access_token
      }
      return token
    },
    async session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub
      }
      return session
    },
    async signIn({ user, account }) {
      // Auto-create user organizations on first sign in
      if (account?.provider === 'google' && user.email) {
        const existingUser = await prisma.user.findUnique({
          where: { email: user.email },
          include: { organizations: true }
        })

        // Create personal organization if user doesn't have one
        if (existingUser && existingUser.organizations.length === 0) {
          const orgSlug = user.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-')
          
          await prisma.organization.create({
            data: {
              name: `${user.name || user.email}'s Organization`,
              slug: orgSlug,
              members: {
                create: {
                  userId: existingUser.id,
                  role: 'OWNER'
                }
              }
            }
          })
        }
      }
      return true
    },
  },
  events: {
    async signIn({ user, account, isNewUser }) {
      // Log sign-in event for audit
      await prisma.auditLog.create({
        data: {
          action: 'user_signin',
          entityType: 'user',
          entityId: user.id,
          userId: user.id,
          metadata: {
            provider: account?.provider,
            isNewUser
          }
        }
      })
    }
  },
  debug: process.env.NODE_ENV === 'development',
}
