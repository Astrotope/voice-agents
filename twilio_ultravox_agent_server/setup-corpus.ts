#!/usr/bin/env ts-node

/**
 * Script to set up the restaurant menu corpus in Ultravox
 * Run with: npx ts-node setup-corpus.ts
 */

import { readFileSync } from 'fs';
import { config } from 'dotenv';

config();

const API_KEY = process.env.ULTRAVOX_API_KEY;
const BASE_URL = 'https://api.ultravox.ai/api';

if (!API_KEY) {
  console.error('❌ ULTRAVOX_API_KEY environment variable is required');
  process.exit(1);
}

interface CorpusResponse {
  corpusId: string;
  name: string;
  description: string;
}

interface UploadResponse {
  presignedUrl: string;
  documentId: string;
}

async function createCorpus(): Promise<string> {
  console.log('📚 Creating restaurant menu corpus...');
  
  const response = await fetch(`${BASE_URL}/corpora`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY!
    },
    body: JSON.stringify({
      name: 'Bella Vista Restaurant Menu',
      description: 'Complete menu, special requirements, and restaurant information for Bella Vista Italian Restaurant'
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create corpus: ${error}`);
  }

  const corpus = await response.json() as CorpusResponse;
  console.log(`✅ Created corpus: ${corpus.corpusId}`);
  return corpus.corpusId;
}

async function requestUploadUrl(corpusId: string): Promise<UploadResponse> {
  console.log('📤 Requesting upload URL...');
  
  const response = await fetch(`${BASE_URL}/corpora/${corpusId}/uploads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY!
    },
    body: JSON.stringify({
      mimeType: 'text/markdown'
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to request upload URL: ${error}`);
  }

  const uploadData = await response.json() as UploadResponse;
  console.log(`✅ Got upload URL for document: ${uploadData.documentId}`);
  return uploadData;
}

async function uploadMenuFile(presignedUrl: string): Promise<void> {
  console.log('📄 Uploading menu file...');
  
  // Read the menu markdown file
  const menuContent = readFileSync('./menu.md', 'utf-8');
  
  const response = await fetch(presignedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/markdown'
    },
    body: menuContent
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to upload menu file: ${error}`);
  }

  console.log('✅ Menu file uploaded successfully');
}

async function createSource(corpusId: string, documentId: string): Promise<void> {
  console.log('🔗 Creating corpus source...');
  
  const response = await fetch(`${BASE_URL}/corpora/${corpusId}/sources`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY!
    },
    body: JSON.stringify({
      upload: {
        documentIds: [documentId]  // Changed from documentId to documentIds array
      }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create source: ${error}`);
  }

  const source = await response.json() as any;
  console.log(`✅ Created source: ${source.sourceId}`);
}

async function addSpecialRequirementsContent(corpusId: string): Promise<void> {
  console.log('🔧 Adding special requirements information...');
  
  const specialRequirements = `# Special Requirements & Dietary Information

## Dietary Accommodations

### Vegetarian Options
- All pasta dishes can be made vegetarian
- Margherita and Quattro Stagioni pizzas are vegetarian
- Eggplant Parmigiana is fully vegetarian
- Caprese salads and appetizers available
- Vegetarian minestrone soup

### Vegan Options  
- Most pasta dishes can be made vegan upon request (dairy-free)
- Pizza dough is vegan-friendly
- Marinara sauce is vegan
- Olive oil and herb preparations available
- Fresh vegetables and salads without cheese

### Gluten-Free Options
- Gluten-free pasta available for +$3 surcharge
- Risotto dishes are naturally gluten-free
- Grilled fish and meat preparations can be made gluten-free
- Salads without croutons
- Please inform server of celiac disease for proper kitchen protocols

### Allergies & Dietary Restrictions
- Nut-free preparations available (please specify tree nuts vs. peanuts)
- Dairy-free options for lactose intolerant guests
- Low-sodium preparations upon request
- Shellfish allergy accommodations (separate prep areas)
- We can modify most dishes to accommodate food allergies

## Accessibility
- Wheelchair accessible entrance and dining room
- Accessible restroom facilities
- High chairs available for children
- Braille menus available upon request
- Staff trained to assist guests with disabilities

## Special Occasions
- Birthday celebrations with complimentary dessert
- Anniversary packages available
- Private dining room for groups 15-30 people
- Custom menu options for special events
- Wine pairings for special occasions

## Children's Accommodations
- High chairs and booster seats available
- Children's portions of most pasta dishes
- Simple preparations (plain pasta, chicken, pizza)
- Kid-friendly atmosphere welcome

## Large Parties
- Parties of 8 or more may have 18% gratuity added
- Groups larger than 12 require manager approval
- Private dining room available for 15-30 guests
- Set menu options for large groups
- Advanced notice appreciated for parties over 6

## Reservation Policies
- Reservations held for 15 minutes past reservation time
- Cancellation required 2 hours in advance
- Same-day reservations subject to availability
- Walk-ins welcome based on availability
- Peak times (Fri-Sat 7-9 PM) may have longer waits`;

  // Upload as additional document
  const uploadResponse = await fetch(`${BASE_URL}/corpora/${corpusId}/uploads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY!
    },
    body: JSON.stringify({
      mimeType: 'text/markdown'
    })
  });

  if (!uploadResponse.ok) {
    throw new Error('Failed to request upload for special requirements');
  }

  const { presignedUrl, documentId } = await uploadResponse.json() as UploadResponse;

  // Upload the content
  await fetch(presignedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/markdown'
    },
    body: specialRequirements
  });

  // Create source
  await fetch(`${BASE_URL}/corpora/${corpusId}/sources`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY!
    },
    body: JSON.stringify({
      upload: { documentIds: [documentId] }  // Changed from documentId to documentIds array
    })
  });

  console.log('✅ Added special requirements information');
}

async function testCorpusQuery(corpusId: string): Promise<void> {
  console.log('🧪 Testing corpus query...');
  
  const response = await fetch(`${BASE_URL}/corpora/${corpusId}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY!
    },
    body: JSON.stringify({
      query: 'What vegetarian options do you have?'
    })
  });

  if (!response.ok) {
    console.log('⚠️  Could not test query (corpus may still be processing)');
    return;
  }

  const result = await response.json() as any;
  console.log('✅ Corpus query test successful');
  console.log('Sample response:', result.response?.slice(0, 100) + '...');
}

async function main() {
  try {
    console.log('🚀 Setting up Bella Vista Restaurant corpus...\n');

    // Create corpus
    const corpusId = await createCorpus();

    // Upload menu file
    const uploadData = await requestUploadUrl(corpusId);
    await uploadMenuFile(uploadData.presignedUrl);
    await createSource(corpusId, uploadData.documentId);

    // Add special requirements information
    await addSpecialRequirementsContent(corpusId);

    // Wait a moment for processing
    console.log('⏳ Waiting for corpus to process...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Test the corpus
    await testCorpusQuery(corpusId);

    console.log('\n🎉 Corpus setup complete!');
    console.log(`📋 Corpus ID: ${corpusId}`);
    console.log('\n📝 Next steps:');
    console.log('1. Update your server.ts file with this corpus ID');
    console.log('2. Add the queryCorpus tool configuration:');
    console.log(`   {
     toolName: "queryCorpus",
     authTokens: {},
     parameterOverrides: {
       corpusId: "${corpusId}"
     }
   }`);
    console.log('3. Start your server with: npm run dev');

  } catch (error: any) {
    console.error('❌ Error setting up corpus:', error.message);
    process.exit(1);
  }
}

// Run the setup
main();
