# Chess Application

A modern chess application built with React, TypeScript, and Vite. This application features a beautiful UI, real-time gameplay, and integration with the Push Protocol.

## 🚀 Features

- Interactive chess board with move validation
- Real-time gameplay capabilities
- Modern and responsive UI
- Integration with Push Protocol for notifications
- TypeScript for type safety
- Vite for fast development and building

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

2. Then, install and run the chess application:

   ```bash
   cd ../../examples/apps/chess
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
- Chess.js for game logic
- React Chessboard for UI
- Push Protocol for notifications
- Viem for Ethereum interactions

## 📚 Project Structure

```
chess/
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
