# Push Rumors Application

A decentralized rumors and news sharing platform built with React, TypeScript, and Vite, integrated with the Push Protocol. This application enables users to share and verify information in a decentralized manner.

## 🚀 Features

- Decentralized rumors and news sharing
- Integration with Push Protocol for notifications
- Markdown support for rich content
- Real-time updates and notifications
- TypeScript for type safety
- Vite for fast development and building
- Blockchain-based verification system

## 🛠️ Prerequisites

- Node.js (v18 or higher)
- Yarn package manager
- Git

## 📦 Installation

1. First, build the shared components:

   ```bash
   cd packages/shared-components
   yarn install
   yarn build
   ```

2. Then, install and run the rumors application:

   ```bash
   cd ../../examples/apps/rumors
   yarn install
   ```

## 🏃‍♂️ Running the Application

### Development Mode

```bash
yarn dev
```

This will start the development server at `http://localhost:5173`

## 🛠️ Tech Stack

- React 18
- TypeScript
- Vite
- Push Protocol for notifications
- Viem for Ethereum interactions
- React Markdown for content rendering
- React Router for navigation
- Protobuf for data serialization

## 📚 Project Structure

```
rumors/
├── src/              # Source files
├── public/           # Static assets
├── components.json   # Component configuration
├── vite.config.ts    # Vite configuration
└── package.json      # Project dependencies
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.
