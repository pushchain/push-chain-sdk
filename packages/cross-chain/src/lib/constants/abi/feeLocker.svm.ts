export const FEE_LOCKER_SVM = [
  {
    address: 'FVnnKN3tmbSuWcHbc8anrXZnzETHn96FdaKcJxamrfFx',
    metadata: {
      name: 'pushsolanalocker',
      version: '0.1.0',
      spec: '0.1.0',
      description: 'Created with Anchor',
    },
    instructions: [
      {
        name: 'add_funds',
        discriminator: [132, 237, 76, 57, 80, 10, 179, 138],
        accounts: [
          {
            name: 'locker',
            pda: {
              seeds: [
                {
                  kind: 'const',
                  value: [108, 111, 99, 107, 101, 114],
                },
              ],
            },
          },
          {
            name: 'vault',
            writable: true,
            pda: {
              seeds: [
                {
                  kind: 'const',
                  value: [118, 97, 117, 108, 116],
                },
              ],
            },
          },
          {
            name: 'user',
            writable: true,
            signer: true,
          },
          {
            name: 'system_program',
            address: '11111111111111111111111111111111',
          },
        ],
        args: [
          {
            name: 'amount',
            type: 'u64',
          },
          {
            name: 'transaction_hash',
            type: {
              array: ['u8', 32],
            },
          },
        ],
      },
      {
        name: 'initialize',
        discriminator: [175, 175, 109, 31, 13, 152, 155, 237],
        accounts: [
          {
            name: 'locker',
            writable: true,
            pda: {
              seeds: [
                {
                  kind: 'const',
                  value: [108, 111, 99, 107, 101, 114],
                },
              ],
            },
          },
          {
            name: 'vault',
            writable: true,
            pda: {
              seeds: [
                {
                  kind: 'const',
                  value: [118, 97, 117, 108, 116],
                },
              ],
            },
          },
          {
            name: 'admin',
            writable: true,
            signer: true,
          },
          {
            name: 'system_program',
            address: '11111111111111111111111111111111',
          },
        ],
        args: [],
      },
      {
        name: 'recover_tokens',
        discriminator: [156, 18, 205, 212, 197, 254, 126, 142],
        accounts: [
          {
            name: 'locker_data',
          },
          {
            name: 'vault',
            writable: true,
            pda: {
              seeds: [
                {
                  kind: 'const',
                  value: [118, 97, 117, 108, 116],
                },
              ],
            },
          },
          {
            name: 'recipient',
            writable: true,
            signer: true,
          },
          {
            name: 'admin',
            writable: true,
            signer: true,
          },
          {
            name: 'system_program',
            address: '11111111111111111111111111111111',
          },
        ],
        args: [
          {
            name: 'amount',
            type: 'u64',
          },
        ],
      },
    ],
    accounts: [
      {
        name: 'Locker',
        discriminator: [74, 246, 6, 113, 249, 228, 75, 169],
      },
    ],
    events: [
      {
        name: 'FundsAddedEvent',
        discriminator: [127, 31, 108, 255, 187, 19, 70, 68],
      },
      {
        name: 'TokenRecoveredEvent',
        discriminator: [72, 100, 110, 181, 188, 125, 10, 53],
      },
    ],
    errors: [
      {
        code: 6000,
        name: 'NoFundsSent',
        msg: 'No SOL sent',
      },
      {
        code: 6001,
        name: 'Unauthorized',
        msg: 'Unauthorized',
      },
    ],
    types: [
      {
        name: 'FundsAddedEvent',
        type: {
          kind: 'struct',
          fields: [
            {
              name: 'user',
              type: 'pubkey',
            },
            {
              name: 'sol_amount',
              type: 'u64',
            },
            {
              name: 'transaction_hash',
              type: {
                array: ['u8', 32],
              },
            },
          ],
        },
      },
      {
        name: 'Locker',
        type: {
          kind: 'struct',
          fields: [
            {
              name: 'admin',
              type: 'pubkey',
            },
            {
              name: 'bump',
              type: 'u8',
            },
            {
              name: 'vault_bump',
              type: 'u8',
            },
          ],
        },
      },
      {
        name: 'TokenRecoveredEvent',
        type: {
          kind: 'struct',
          fields: [
            {
              name: 'admin',
              type: 'pubkey',
            },
            {
              name: 'amount',
              type: 'u64',
            },
          ],
        },
      },
    ],
  },
];
